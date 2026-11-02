// The study tutor's next turn (lib/tutor.ts).
//
// It acts as the person studying: their sign-in token goes to Supabase with every query, so the
// database's own rules decide what the tutor can read -- the menu, story, standards and words of a
// restaurant they belong to, nothing else. No service key is involved, and nothing is saved.
//
// The answer comes from Claude Haiku 5.5. Until ANTHROPIC_API_KEY is set in Vercel this route answers
// {configured: false} and the Tutor screen says so. The restaurant's document is sent as a cached
// prefix, so each new turn of a conversation only pays full price for the newest messages.
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import type { CardFieldRow } from "@/lib/card-fields";
import { cleanConversation, knowledgeText, tutorSystem, type TutorItem, type TutorStandard, type TutorStory, type TutorWord } from "@/lib/tutor";

const MODEL = "claude-haiku-5-5";

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
  const [place, items, cardRows, story, standards, words] = await Promise.all([
    db.from("restaurants").select("name").eq("id", rid).maybeSingle(),
    db.from("menu_items").select("name, description, ingredients, allergens, category, content_type, price_label, table_setting, observations, details").eq("restaurant_id", rid),
    db.from("card_fields").select("content_type, field_key, custom, label, kind, hidden, on_card, show_team, sort_order").eq("restaurant_id", rid),
    db.from("story_topics").select("title, body, section, sort_order").eq("restaurant_id", rid).order("sort_order"),
    db.from("sops").select("name, section, why, steps, sort_order").eq("restaurant_id", rid).order("sort_order"),
    db.from("glossary_terms").select("term, say, means, note, story").eq("restaurant_id", rid).eq("hidden", false).order("term"),
  ]);
  if (place.error || !place.data || items.error) return Response.json({error: "That restaurant isn't available to you."}, {status: 403});
  const restaurant = place.data.name as string;
  // Older restaurants may not have every table yet; the tutor teaches from whatever is there.
  const document = knowledgeText({
    restaurant,
    items: (items.data ?? []) as TutorItem[],
    cardRows: (cardRows.data ?? []) as CardFieldRow[],
    story: (story.data ?? []) as TutorStory[],
    standards: (standards.data ?? []) as TutorStandard[],
    words: (words.data ?? []) as TutorWord[],
  });

  const client = new Anthropic({apiKey});
  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 4000,
      output_config: {effort: "low"},
      system: [
        {type: "text", text: tutorSystem(restaurant)},
        {type: "text", text: `<restaurant_information>\n${document}\n</restaurant_information>`, cache_control: {type: "ephemeral"}},
        {type: "text", text: body.lang === "es" ? "Reply in Spanish (tú), keeping dish names as the menu writes them." : "Reply in English."},
      ],
      messages,
    });
    if (response.stop_reason === "refusal") return Response.json({reply: body.lang === "es" ? "No puedo ayudar con eso. Sigamos estudiando el menú: ¿qué quieres repasar?" : "I can't help with that. Let's keep studying the menu: what would you like to go over?"});
    const reply = response.content.flatMap(block => block.type === "text" ? [block.text] : []).join("\n").trim();
    if (!reply) return Response.json({error: "The tutor didn't answer. Try again."}, {status: 502});
    return Response.json({reply});
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) return Response.json({error: "The tutor is busy. Try again in a minute."}, {status: 429});
    if (error instanceof Anthropic.AuthenticationError) return Response.json({error: "The tutor's key isn't valid. Ask the app's owner to check ANTHROPIC_API_KEY."}, {status: 502});
    if (error instanceof Anthropic.APIError) return Response.json({error: `The tutor service answered ${error.status ?? "an error"}. Try again.`}, {status: 502});
    return Response.json({error: "Couldn't reach the tutor. Check your connection and try again."}, {status: 502});
  }
}
