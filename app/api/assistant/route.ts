// The managers' assistant's next turn (lib/assistant.ts), streamed as it is written.
//
// It acts as the manager asking: their sign-in token goes to Supabase with every query, so the
// database's own rules decide what each tool can read -- a manager without Team access can't see
// the team's study, one without Pre-shift or Team access can't read shift reports. No service key
// is involved and nothing is written: propose_assignment only shows the manager a card, and the
// Assistant screen assigns through the app's own assign_menu_items when they confirm.
//
// Answers come from Claude Sonnet 5.5, with the server-side fallback on so a declined turn is
// retried on another model. Until ANTHROPIC_API_KEY is set this route answers {configured: false}.
//
// The reply is newline-separated JSON: {"text"} pieces as they are written, {"working": "<tool>"}
// while a tool runs, {"proposal": {...}} for a card to confirm, and {"error"} if it stops partway.
// Problems found before the assistant starts answer with plain JSON instead.
import Anthropic from "@anthropic-ai/sdk";
import { replyLanguage } from "@/lib/reply-language";
import { createClient } from "@supabase/supabase-js";
import { assistantSystem, checkProposal, checkRange, hoursView, localDay, reportsView, scheduleView, type MenuEntry, type Proposal, type Report, type Shift, type TeamMember } from "@/lib/assistant";
import { cleanConversation } from "@/lib/tutor";

const MODEL = "claude-sonnet-5-5";
const MAX_ROUNDS = 8;
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const range = {
  from: {type: "string", description: "First day, YYYY-MM-DD, in the restaurant's time zone."},
  to: {type: "string", description: "Last day, YYYY-MM-DD, included. At most 31 days after from."},
};
const TOOLS: Anthropic.Beta.BetaTool[] = [
  {name: "get_schedule", description: "Shifts between two days (published, plus drafts when this manager can see them): day, person, position, times, hours; hours per person with how far over the weekly overtime limit; and time-off requests and shift changes still waiting for an answer.",
    eager_input_streaming: true, input_schema: {type: "object", properties: range, required: ["from", "to"], additionalProperties: false}},
  {name: "get_team_study", description: "Everyone on the team with their study: quizzes taken, average score, how many need review, last activity, and what they missed with the tutor recently.",
    eager_input_streaming: true, input_schema: {type: "object", properties: {}, additionalProperties: false}},
  {name: "get_person_study", description: "One person's study card by card: each quiz result and whether it needs review, plus tutor practice results with what they missed.",
    eager_input_streaming: true, input_schema: {type: "object", properties: {user_id: {type: "string", description: "The person's user_id from get_team_study."}}, required: ["user_id"], additionalProperties: false}},
  {name: "get_shift_reports", description: "Shift reports between two days: mood, covers, issues (urgent ones flagged), low stock, shout-outs, notes for the next shift.",
    eager_input_streaming: true, input_schema: {type: "object", properties: range, required: ["from", "to"], additionalProperties: false}},
  {name: "get_menu", description: "Every card on the menu: id, name, section and library (food, cocktails, wine). Use it to find the ids to propose for study.",
    eager_input_streaming: true, input_schema: {type: "object", properties: {}, additionalProperties: false}},
  {name: "propose_assignment", description: "Propose giving cards to study to some team members. Nothing is assigned: the manager sees a card and confirms or cancels it.",
    eager_input_streaming: true, input_schema: {type: "object", properties: {
      user_ids: {type: "array", items: {type: "string"}, description: "The people's user_ids (from get_team_study)."},
      menu_item_ids: {type: "array", items: {type: "string"}, description: "The cards' ids (from get_menu)."},
      note: {type: "string", description: "A short note they will see with it, or empty."},
    }, required: ["user_ids", "menu_item_ids", "note"], additionalProperties: false}},
];
const WORKING: Record<string, string> = {get_schedule: "schedule", get_team_study: "team", get_person_study: "team", get_shift_reports: "reports", get_menu: "menu", propose_assignment: "proposal"};

export async function POST(request: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return Response.json({configured: false});

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const body = await request.json().catch(() => ({})) as {restaurantId?: string; messages?: unknown; lang?: string};
  const messages = cleanConversation(body.messages);
  if (!url || !key || !token || !body.restaurantId || !messages) return Response.json({error: "Missing restaurant, message or sign-in."}, {status: 400});

  const db = createClient(url, key, {
    auth: {persistSession: false, autoRefreshToken: false},
    global: {headers: {Authorization: `Bearer ${token}`}},
  });
  const rid = body.restaurantId;
  const me = (await db.auth.getUser(token)).data.user?.id;
  if (!me) return Response.json({error: "Please sign in again."}, {status: 401});
  const [place, membership, teamRows, menuRows, settings] = await Promise.all([
    db.from("restaurants").select("name, owner_id").eq("id", rid).maybeSingle(),
    db.from("restaurant_members").select("access").eq("restaurant_id", rid).eq("user_id", me).maybeSingle(),
    db.rpc("schedule_team", {rid}),
    db.from("menu_items").select("id, name, category, content_type").eq("restaurant_id", rid).order("name"),
    db.from("schedule_settings").select("*").eq("restaurant_id", rid).maybeSingle(),
  ]);
  if (place.error || !place.data) return Response.json({error: "That restaurant isn't available to you."}, {status: 403});
  const owner = place.data.owner_id === me;
  const access = owner ? ["team", "preshift", "library", "schedule_foh", "schedule_boh"] : ((membership.data?.access ?? []) as string[]);
  if (!owner && !access.length) return Response.json({error: "The assistant is for managers."}, {status: 403});

  const team = (teamRows.data ?? []) as TeamMember[];
  const menu = (menuRows.data ?? []) as MenuEntry[];
  const s = (settings.data ?? {}) as {time_zone?: string; week_start?: number; overtime_weekly?: number; overtime_daily?: number | null};
  const timeZone = s.time_zone || "America/New_York";
  const weeklyLimit = Number(s.overtime_weekly ?? 40);
  const today = localDay(new Date(), timeZone);
  const canAssign = owner || access.includes("team");
  const tools = canAssign ? TOOLS : TOOLS.filter(t => t.name !== "propose_assignment");
  const system: Anthropic.Beta.BetaTextBlockParam[] = [{type: "text", text: assistantSystem({
    restaurant: place.data.name as string, today: today.day, weekday: today.weekday, timeZone,
    weekStart: WEEKDAYS[s.week_start ?? 1] ?? "Monday", overtimeWeekly: weeklyLimit, overtimeDaily: s.overtime_daily ?? null,
    manager: team.find(m => m.user_id === me)?.name ?? "the manager",
  }) + (canAssign ? "" : "\n\nThis manager has no Team access: you can't propose study assignments.")}, {type: "text", text: replyLanguage(body.lang)}];

  const denied = (error: {code?: string; message?: string} | null) =>
    error && (error.code === "42501" || /access|permission|denied/i.test(error.message ?? "")) ? "Not available with your access." : "Couldn't read that right now.";
  const nameOf = (id: string) => team.find(m => m.user_id === id)?.name ?? "Former team member";
  const cardName = (id: string) => menu.find(m => m.id === id)?.name ?? "A card no longer on the menu";

  // Each tool returns plain JSON for the model, or a short sentence when it can't.
  async function run(name: string, input: Record<string, unknown>, send: (piece: object) => void): Promise<{content: string; error?: boolean}> {
    if (name === "get_schedule" || name === "get_shift_reports") {
      const span = checkRange(input.from, input.to);
      if (!span) return {content: "Give from and to as YYYY-MM-DD, at most 31 days apart.", error: true};
      if (name === "get_shift_reports") {
        const found = await db.from("shift_reports").select("service_date, label, mood, covers, urgent, issues, low_stock, shoutouts, next_shift, notes")
          .eq("restaurant_id", rid).gte("service_date", span.from).lte("service_date", span.to);
        if (found.error) return {content: denied(found.error)};
        return {content: JSON.stringify({reports: reportsView((found.data ?? []) as Report[])})};
      }
      // A day either side in UTC, then keep the shifts whose local day is in range.
      const fromTs = new Date(Date.parse(`${span.from}T00:00:00Z`) - 864e5).toISOString();
      const toTs = new Date(Date.parse(`${span.to}T00:00:00Z`) + 2 * 864e5).toISOString();
      const [shifts, timeOff, changes] = await Promise.all([
        db.from("schedule_shifts").select("*").eq("restaurant_id", rid).gte("starts_at", fromTs).lt("starts_at", toTs),
        db.from("time_off_requests").select("user_id, starts_on, ends_on, note").eq("restaurant_id", rid).eq("status", "pending").lte("starts_on", span.to).gte("ends_on", span.from),
        db.from("shift_changes").select("kind, status, requested_by, taker_id, note, shift_id").eq("restaurant_id", rid).in("status", ["open", "asked", "pending"]),
      ]);
      if (shifts.error) return {content: denied(shifts.error)};
      const inRange = ((shifts.data ?? []) as Shift[]).filter(sh => { const d = localDay(new Date(sh.starts_at), timeZone).day; return d >= span.from && d <= span.to; });
      return {content: JSON.stringify({
        from: span.from, to: span.to, weekly_overtime_limit: weeklyLimit,
        shifts: scheduleView(inRange, team, timeZone),
        hours_by_person: hoursView(inRange, team, weeklyLimit),
        time_off_waiting: timeOff.error ? "Not available with your access." : (timeOff.data ?? []).map(t => ({person: nameOf(t.user_id), from: t.starts_on, to: t.ends_on, note: t.note})),
        shift_changes_waiting: changes.error ? "Not available with your access." : (changes.data ?? []).map(c => ({kind: c.kind, status: c.status, from: nameOf(c.requested_by), to: c.taker_id ? nameOf(c.taker_id) : null, note: c.note})),
      })};
    }
    if (name === "get_team_study") {
      const [roster, practice] = await Promise.all([
        db.rpc("team_learning_roster", {rid}),
        db.from("tutor_practice").select("user_id, menu_item_id, result, missed, created_at").eq("restaurant_id", rid).order("created_at", {ascending: false}).limit(2000),
      ]);
      if (roster.error) return {content: denied(roster.error)};
      // The newest tutor result per person and card; only the ones that weren't right.
      const latest = new Map<string, {user_id: string; menu_item_id: string; result: string; missed: string}>();
      for (const p of practice.data ?? []) if (!latest.has(`${p.user_id}|${p.menu_item_id}`)) latest.set(`${p.user_id}|${p.menu_item_id}`, p);
      return {content: JSON.stringify({team: ((roster.data ?? []) as {user_id: string; name: string; role: string; is_owner: boolean; items_taken: number; correct_sum: number; total_sum: number; needs_review: number; last_attempt_at: string | null}[])
        .filter(r => !r.is_owner).map(r => ({
          user_id: r.user_id, name: r.name, role: r.role, quizzes_taken: r.items_taken,
          average_score: r.total_sum ? `${Math.round(100 * r.correct_sum / r.total_sum)}%` : null,
          quizzes_needing_review: r.needs_review, last_quiz: r.last_attempt_at?.slice(0, 10) ?? null,
          tutor_missed: [...latest.values()].filter(p => p.user_id === r.user_id && p.result !== "correct").slice(0, 10).map(p => ({card: cardName(p.menu_item_id), result: p.result, missed: p.missed})),
        }))})};
    }
    if (name === "get_person_study") {
      const id = typeof input.user_id === "string" ? input.user_id : "";
      if (!team.some(m => m.user_id === id)) return {content: "That user_id isn't on this team. Use one from get_team_study.", error: true};
      const [results, practice] = await Promise.all([
        db.rpc("team_member_progress", {rid, learner_id: id}),
        db.from("tutor_practice").select("menu_item_id, result, missed, created_at").eq("restaurant_id", rid).eq("user_id", id).order("created_at", {ascending: false}).limit(300),
      ]);
      if (results.error) return {content: denied(results.error)};
      return {content: JSON.stringify({person: nameOf(id),
        quizzes: ((results.data ?? []) as {item_name: string; correct: number; total: number; created_at: string; needs_review: boolean}[]).map(r => ({card: r.item_name, score: `${r.correct}/${r.total}`, date: r.created_at.slice(0, 10), needs_review: r.needs_review || r.correct / r.total < 0.8})),
        tutor_practice: (practice.data ?? []).slice(0, 40).map(p => ({card: cardName(p.menu_item_id), result: p.result, missed: p.missed, date: p.created_at.slice(0, 10)})),
      })};
    }
    if (name === "get_menu") return {content: JSON.stringify({cards: menu.map(m => ({id: m.id, name: m.name, section: m.category ?? "", library: m.content_type ?? "food"}))})};
    if (name === "propose_assignment") {
      const proposal: Proposal | null = checkProposal(input, team, menu);
      if (!proposal) return {content: "Not shown: use user_ids from get_team_study and card ids from get_menu (up to 20 people and 40 cards).", error: true};
      send({proposal});
      return {content: "Shown to the manager as a card to confirm or cancel. Nothing is assigned until they confirm; don't say it is done."};
    }
    return {content: `There is no tool called ${name}.`, error: true};
  }

  const client = new Anthropic({apiKey});
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (piece: object) => controller.enqueue(encoder.encode(JSON.stringify(piece) + "\n"));
      const history: Anthropic.Beta.BetaMessageParam[] = [...messages];
      let wrote = false;
      try {
        for (let round = 0; round < MAX_ROUNDS; round++) {
          const turn = client.beta.messages.stream({
            model: MODEL,
            max_tokens: 8000,
            betas: ["server-side-fallback-2026-07-01"],
            fallbacks: "default",
            output_config: {effort: "medium"},
            system,
            tools,
            messages: history,
          });
          let fresh = true;
          for await (const event of turn) {
            if (event.type === "content_block_delta" && event.delta.type === "text_delta" && event.delta.text) {
              send({text: fresh && wrote ? `\n\n${event.delta.text}` : event.delta.text});
              fresh = false; wrote = true;
            }
          }
          const message = await turn.finalMessage();
          if (message.stop_reason === "refusal") {
            if (!wrote) send({text: "I can't help with that one. Ask me about the schedule, the team's study or the shift reports."});
            break;
          }
          const calls = message.content.filter((block): block is Anthropic.Beta.BetaToolUseBlock => block.type === "tool_use");
          if (message.stop_reason !== "tool_use" || !calls.length) break;
          const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
          for (const call of calls) {
            send({working: WORKING[call.name] ?? "other"});
            const out = await run(call.name, (call.input ?? {}) as Record<string, unknown>, send);
            results.push({type: "tool_result", tool_use_id: call.id, content: out.content, ...(out.error ? {is_error: true} : {})});
          }
          history.push({role: "assistant", content: message.content}, {role: "user", content: results});
        }
        if (!wrote) send({error: "The assistant didn't answer. Try again."});
      } catch (error) {
        send({error: error instanceof Anthropic.RateLimitError ? "The assistant is busy. Try again in a minute."
          : error instanceof Anthropic.AuthenticationError ? "The assistant's key isn't valid. Ask the app's owner to check ANTHROPIC_API_KEY."
          : error instanceof Anthropic.APIError ? `The assistant service answered ${error.status ?? "an error"}. Try again.`
          : "The assistant stopped partway. Try again."});
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {headers: {"Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store"}});
}
