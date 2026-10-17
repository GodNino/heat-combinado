"use client";
// Before the app moved to /app, every email link came back to "/": invites, password resets,
// sign-up confirmations. Links already sitting in inboxes still do, and so does Supabase's Site URL
// until it is changed. Anything that looks like one of those is passed on to /app untouched.
import { useEffect } from "react";

export function AuthForward() {
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const fromEmail = ["invite", "reset", "code", "start"].some(key => query.has(key))
      || ["access_token", "error_code", "type"].some(key => hash.has(key));
    if (fromEmail) window.location.replace("/app" + window.location.search + window.location.hash);
  }, []);
  return null;
}
