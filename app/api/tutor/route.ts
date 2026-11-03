// The study tutor's next turn (lib/tutor.ts), streamed as it is written.
//
// It acts as the person studying: their sign-in token goes to Supabase with every query, so the
// database's own rules decide what the tutor can read -- the menu, story, standards and words of a
// restaurant they belong to -- and what it can write: practice results for that person only
// (tutor_practice, migration 057). No service key is involved.
//
// The tutor reads HEAT's shared manual (lib/tutor-manual.ts) and then the restaurant's own document,
// which always wins over it. The answer comes from Claude Haiku 5.5. Until ANTHROPIC_API_KEY is set in Vercel this route answers
// {configured: false} and the Tutor screen says so. The restaurant's document is sent as a cached
// prefix, so each new turn of a conversation only pays full price for the newest messages.
//
// The reply is newline-separated JSON: {"text": "..."} pieces as they are written, and {"error": "..."}
// if the tutor stops partway. Problems found before the tutor starts answer with plain JSON instead.
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import type { CardFieldRow } from "@/lib/card-fields";
import { cleanConversation, historyText, knowledge, parsePractice, tutorSystem, type PracticeRow, type TutorItem, type TutorStandard, type TutorStory, type TutorWord } from "@/lib/tutor";
import { TUTOR_EXAMPLES, TUTOR_MANUAL } from "@/lib/tutor-manual";

const MODEL = "claude-haiku-5-5";
// A turn that records practice takes two rounds (answer + record, then the rest of the answer);
// anything beyond a few is the model looping.
const MAX_ROUNDS = 4;

const RECORD_PRACTICE: Anthropic.Tool = {
  name: "record_practice",
  description: "Save how the person did on one card, once they have answered your questions about it and you have corrected them. Never mention it to them.",
  eager_input_streaming: true,
  input_schema: {
    type: "object",
    properties: {
      card: {type: "integer", description: "The card's number from the document, e.g. 12 for \"(card 12)\"."},
      result: {type: "string", enum: ["correct", "partly", "wrong"], description: "correct: knew it; partly: missed some of it; wrong: mostly didn't know it."},
      missed: {type: "string", description: "What they got wrong, in a few words (e.g. \"sesame allergen\"). Empty when correct."},
    },
    required: ["card", "result", "missed"],
    additionalProperties: false,
  },
};

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
  const [place, items, cardRows, story, standards, words, practice] = await Promise.all([
    db.from("restaurants").select("name").eq("id", rid).maybeSingle(),
    db.from("menu_items").select("id, name, description, ingredients, allergens, category, content_type, price_label, table_setting, observations, details").eq("restaurant_id", rid),
    db.from("card_fields").select("content_type, field_key, custom, label, kind, hidden, on_card, show_team, sort_order").eq("restaurant_id", rid),
    db.from("story_topics").select("title, body, section, sort_order").eq("restaurant_id", rid).order("sort_order"),
    db.from("sops").select("name, section, why, steps, sort_order").eq("restaurant_id", rid).order("sort_order"),
    db.from("glossary_terms").select("term, say, means, note, story").eq("restaurant_id", rid).eq("hidden", false).order("term"),
    db.from("tutor_practice").select("menu_item_id, result, missed, created_at").eq("restaurant_id", rid).eq("user_id", me).order("created_at", {ascending: false}).limit(500),
  ]);
  if (place.error || !place.data || items.error) return Response.json({error: "That restaurant isn't available to you."}, {status: 403});
  const restaurant = place.data.name as string;
  // Older restaurants may not have every table yet; the tutor teaches from whatever is there. Until
  // migration 057 runs there is nothing to remember, so the tutor is not offered the tool.
  const remembers = !practice.error;
  const doc = knowledge({
    restaurant,
    items: (items.data ?? []) as TutorItem[],
    cardRows: (cardRows.data ?? []) as CardFieldRow[],
    story: (story.data ?? []) as TutorStory[],
    standards: (standards.data ?? []) as TutorStandard[],
    words: (words.data ?? []) as TutorWord[],
  });
  const system: Anthropic.TextBlockParam[] = [
    {type: "text", text: tutorSystem(restaurant)},
    // HEAT's shared craft and how the tutor should sound, the same for every restaurant.
    {type: "text", text: `<heat_tutor_manual>\n${TUTOR_MANUAL}\n</heat_tutor_manual>\n\n<how_you_sound>\n${TUTOR_EXAMPLES}\n</how_you_sound>`, cache_control: {type: "ephemeral"}},
    {type: "text", text: `<restaurant_information>\n${doc.text}\n</restaurant_information>`, cache_control: {type: "ephemeral"}},
    ...(remembers ? [{type: "text" as const, text: `<their_history>\n${historyText((practice.data ?? []) as PracticeRow[], doc.cards)}\n</their_history>`}] : []),
    {type: "text", text: body.lang === "es" ? "Reply in Spanish (tú), keeping dish names as the menu writes them." : "Reply in English."},
  ];

  const client = new Anthropic({apiKey});
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (piece: {text: string} | {error: string}) => controller.enqueue(encoder.encode(JSON.stringify(piece) + "\n"));
      const history: Anthropic.MessageParam[] = [...messages];
      let wrote = false;
      try {
        for (let round = 0; round < MAX_ROUNDS; round++) {
          const turn = client.messages.stream({
            model: MODEL,
            max_tokens: 4000,
            output_config: {effort: "low"},
            system,
            ...(remembers ? {tools: [RECORD_PRACTICE]} : {}),
            messages: history,
          });
          // Text after a recording carries on the same answer; keep it apart from what came before.
          let fresh = true;
          for await (const event of turn) {
            if (event.type === "content_block_delta" && event.delta.type === "text_delta" && event.delta.text) {
              send({text: fresh && wrote ? `\n\n${event.delta.text}` : event.delta.text});
              fresh = false; wrote = true;
            }
          }
          const message = await turn.finalMessage();
          if (message.stop_reason === "refusal") {
            if (!wrote) send({text: body.lang === "es" ? "No puedo ayudar con eso. Sigamos estudiando el menú: ¿qué quieres repasar?" : "I can't help with that. Let's keep studying the menu: what would you like to go over?"});
            break;
          }
          const calls = message.content.filter((block): block is Anthropic.ToolUseBlock => block.type === "tool_use");
          // A recording cut off by max_tokens may look complete; don't write it.
          if (message.stop_reason !== "tool_use" || !calls.length) break;
          const results: Anthropic.ToolResultBlockParam[] = await Promise.all(calls.map(async call => {
            const row = call.name === "record_practice" ? parsePractice(call.input, doc.cards) : null;
            if (!row) return {type: "tool_result", tool_use_id: call.id, is_error: true, content: "Not saved: use a card number from the document, a result of correct, partly or wrong, and a short note."};
            const saved = await db.from("tutor_practice").insert({restaurant_id: rid, ...row});
            return saved.error
              ? {type: "tool_result", tool_use_id: call.id, is_error: true, content: "Not saved this time. Carry on teaching without mentioning it."}
              : {type: "tool_result", tool_use_id: call.id, content: "Saved."};
          }));
          history.push({role: "assistant", content: message.content}, {role: "user", content: results});
        }
        if (!wrote) send({error: "The tutor didn't answer. Try again."});
      } catch (error) {
        send({error: error instanceof Anthropic.RateLimitError ? "The tutor is busy. Try again in a minute."
          : error instanceof Anthropic.AuthenticationError ? "The tutor's key isn't valid. Ask the app's owner to check ANTHROPIC_API_KEY."
          : error instanceof Anthropic.APIError ? `The tutor service answered ${error.status ?? "an error"}. Try again.`
          : "The tutor stopped partway. Try again."});
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {headers: {"Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store"}});
}
