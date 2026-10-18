"use client";
// The demo kitchen: a real HEAT workspace with a sample menu, opened without an account.
// The visitor gets an anonymous Supabase account and their own copy of the restaurant marked
// is_demo (migration 037), as its owner, so the guided tour can have them really add a dish or
// make an invite link. Nobody else sees the copy, and it is removed after 7 days.
import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { HeatLogo } from "../heat-logo";

// One opening per page load. React may run the effect twice (it does in development), and two
// overlapping runs would each sign in anonymously and each get a demo copy of their own.
let opening: Promise<{signedInAs: string} | {opened: true}> | null = null;
function openDemo() {
  const client = supabase!;
  return opening ??= (async () => {
    const { data } = await client.auth.getSession();
    const current = data.session?.user;
    // A real account stays as it is: opening the demo must never sign someone out of their restaurant.
    if (current && !current.is_anonymous) return {signedInAs: current.email ?? "your account"};
    if (!current) {
      const signIn = await client.auth.signInAnonymously();
      if (signIn.error) throw new Error("The demo kitchen is closed right now. Please try again later.");
    }
    const opened = await client.rpc("start_demo");
    if (opened.error) throw new Error("The demo kitchen isn't set up yet. Please try again later.");
    return {opened: true as const};
  })();
}

export default function Demo() {
  const [problem, setProblem] = useState("");
  const [signedInAs, setSignedInAs] = useState("");
  useEffect(() => {
    if (!supabase) return setProblem("The demo needs the HEAT database, and this copy of HEAT is not connected to one yet.");
    let live = true;
    openDemo().then(result => {
      if (!live) return;
      if ("signedInAs" in result) setSignedInAs(result.signedInAs);
      else window.location.replace("/app");
    }).catch(e => live && setProblem(e instanceof Error ? e.message : "The demo could not open."));
    return () => {live = false;};
  }, []);
  return <main className="flex min-h-screen items-center justify-center px-6 py-12">
    <div className="w-full max-w-md enter">
      <a href="/" className="mb-10 inline-flex items-center gap-2 text-2xl font-black" aria-label="HEAT home"><HeatLogo /></a>
      <p className="eyebrow muted mb-3">Demo kitchen</p>
      {signedInAs ? <>
        <h1 className="text-2xl font-semibold tracking-tight">You're already signed in</h1>
        <p className="muted mt-3 mb-8">You're signed in as {signedInAs}. Sign out first to look around the demo kitchen, or go back to your own restaurant.</p>
        <a href="/app" className="btn w-full">Open my workspace</a>
        <button type="button" className="btn secondary mt-3 w-full" onClick={async () => {await supabase?.auth.signOut(); window.location.reload();}}>Sign out and open the demo</button>
      </> : problem ? <>
        <h1 className="text-2xl font-semibold tracking-tight">The demo didn't open</h1>
        <p className="muted mt-3 mb-8">{problem}</p>
        <a href="/trial" className="btn w-full">Start a free trial instead</a>
        <a href="/" className="btn secondary mt-3 w-full"><ArrowLeft size={16} />Back to HEAT</a>
      </> : <>
        <h1 className="text-2xl font-semibold tracking-tight">Setting the table…</h1>
        <p className="muted mt-3" role="status">Opening your own copy of a sample restaurant. No account needed: change anything you like, it's yours for 7 days.</p>
      </>}
    </div>
  </main>;
}
