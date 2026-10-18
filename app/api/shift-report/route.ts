// Emails a submitted shift report to everyone who should read it.
//
// It acts as the manager who submitted: their sign-in token goes to Supabase with every query,
// so the database's own rules decide which report they can read and who receives it
// (shift_report_recipients in migration 038). No service key is involved.
//
// Sending uses Resend. Until RESEND_API_KEY is set in Vercel, reports are saved and shown in the
// app, and this route answers {configured: false}. REPORTS_FROM sets the sender address; it must be
// on a domain verified in Resend (for example heatplatform.io).
import { createClient } from "@supabase/supabase-js";
import { reportEmail, type ShiftReport } from "@/lib/shift-report";

export async function POST(request: Request) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return Response.json({sent: 0, configured: false});

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const {reportId} = await request.json().catch(() => ({})) as {reportId?: string};
  if (!url || !key || !token || !reportId) return Response.json({error: "Missing report or sign-in."}, {status: 400});

  const db = createClient(url, key, {
    auth: {persistSession: false, autoRefreshToken: false},
    global: {headers: {Authorization: `Bearer ${token}`}},
  });
  const found = await db.from("shift_reports").select("*").eq("id", reportId).maybeSingle();
  if (found.error || !found.data) return Response.json({error: "That report isn't available to you."}, {status: 403});
  const report = found.data as ShiftReport;
  const [place, people] = await Promise.all([
    db.from("restaurants").select("name").eq("id", report.restaurant_id).maybeSingle(),
    db.rpc("shift_report_recipients", {report_id: reportId}),
  ]);
  if (people.error) return Response.json({error: people.error.message}, {status: 403});
  const to = ((people.data ?? []) as {email: string}[]).map(row => row.email);
  if (!to.length) return Response.json({sent: 0, configured: true});

  const origin = new URL(request.url).origin;
  const mail = reportEmail(report, (place.data?.name as string | undefined) ?? "Your restaurant", `${origin}/app`);
  // One email to the whole management team, the way the old message went out. Resend takes up to 50.
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json"},
    body: JSON.stringify({
      from: process.env.REPORTS_FROM ?? "HEAT <reports@heatplatform.io>",
      to: to.slice(0, 50),
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
    }),
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => null) as {message?: string} | null;
    return Response.json({error: detail?.message ?? `The email service answered ${response.status}.`}, {status: 502});
  }
  return Response.json({sent: Math.min(to.length, 50), configured: true});
}
