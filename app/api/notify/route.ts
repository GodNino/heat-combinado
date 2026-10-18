// Sends phone notifications for something that just happened in HEAT.
//
// First, as the person who caused it (their sign-in token), the database decides whether they may
// announce it and to whom (push_audience in migration 039). Only then does the server read those
// people's devices with its own key, which never leaves the server, and send the messages.
//
// Needs, in Vercel: NEXT_PUBLIC_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:…) and
// SUPABASE_SERVICE_ROLE_KEY. Until they're set, this answers {configured: false} and nothing breaks.
import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";
import { PUSH_EVENTS, pushMessage, type PushEvent } from "@/lib/push-messages";

export async function POST(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!url || !anonKey || !serviceKey || !publicKey || !privateKey) return Response.json({sent: 0, configured: false});

  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const {event, ref, target} = await request.json().catch(() => ({})) as {event?: string; ref?: string; target?: string};
  if (!token || !ref || !PUSH_EVENTS.includes(event as PushEvent)) return Response.json({error: "Missing event or sign-in."}, {status: 400});

  const asCaller = createClient(url, anonKey, {
    auth: {persistSession: false, autoRefreshToken: false},
    global: {headers: {Authorization: `Bearer ${token}`}},
  });
  const who = await asCaller.rpc("push_audience", {event, ref, target: target ?? null});
  if (who.error) return Response.json({error: who.error.message}, {status: 403});
  const row = (who.data as {restaurant_name: string; user_ids: string[]}[] | null)?.[0];
  if (!row?.user_ids.length) return Response.json({sent: 0, configured: true});

  const server = createClient(url, serviceKey, {auth: {persistSession: false, autoRefreshToken: false}});
  const devices = await server.from("push_subscriptions").select("id,endpoint,p256dh,auth,lang").in("user_id", row.user_ids);
  if (devices.error) return Response.json({error: devices.error.message}, {status: 500});

  webpush.setVapidDetails(process.env.VAPID_SUBJECT ?? "mailto:hello@heatplatform.io", publicKey, privateKey);
  const gone: string[] = [];
  let sent = 0;
  await Promise.all((devices.data ?? []).map(async device => {
    try {
      await webpush.sendNotification(
        {endpoint: device.endpoint, keys: {p256dh: device.p256dh, auth: device.auth}},
        JSON.stringify(pushMessage(event as PushEvent, device.lang, row.restaurant_name)),
        {TTL: 6 * 3600},
      );
      sent++;
    } catch (error) {
      // The phone turned notifications off or the browser was reset: forget that device.
      const status = (error as {statusCode?: number}).statusCode;
      if (status === 404 || status === 410) gone.push(device.id);
    }
  }));
  if (gone.length) await server.from("push_subscriptions").delete().in("id", gone);
  return Response.json({sent, configured: true});
}
