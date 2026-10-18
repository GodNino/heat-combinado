"use client";
// Phone notifications: the switch that turns them on for this device, and notify(), which the app
// calls right after something worth telling people about (app/api/notify sends the messages).
// They're off until each person turns them on; HEAT never asks out of the blue.
import { useEffect, useState } from "react";
import { Bell, BellOff } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { PushEvent } from "@/lib/push-messages";
import { useLang } from "./language";

const PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

// Fire and forget: a notification that doesn't go out must never get in the way of the work itself.
export function notify(event: PushEvent, ref: string, target?: string) {
  if (!PUBLIC_KEY || !supabase) return;
  void supabase.auth.getSession().then(({data}) => fetch("/api/notify", {
    method: "POST",
    headers: {"Content-Type": "application/json", Authorization: `Bearer ${data.session?.access_token ?? ""}`},
    body: JSON.stringify({event, ref, target}),
  })).catch(() => {});
}

function keyBytes(base64: string) {
  const padded = (base64 + "=".repeat((4 - base64.length % 4) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(padded), c => c.charCodeAt(0));
}

type State = "loading" | "unsupported" | "install" | "blocked" | "off" | "on";

async function currentSubscription() {
  const registration = await navigator.serviceWorker.getRegistration("/");
  return registration ? registration.pushManager.getSubscription() : null;
}

export function NotificationSwitch() {
  const lang = useLang();
  const [state, setState] = useState<State>("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!PUBLIC_KEY || typeof window === "undefined") return setState("unsupported");
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as {standalone?: boolean}).standalone === true;
    const iphone = /iPhone|iPad|iPod/.test(navigator.userAgent);
    // An iPhone only gets notifications from HEAT once it's added to the Home Screen.
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return setState(iphone && !standalone ? "install" : "unsupported");
    if (Notification.permission === "denied") return setState("blocked");
    void currentSubscription().then(sub => setState(sub ? "on" : "off")).catch(() => setState("off"));
  }, []);
  // A device that's on keeps speaking the person's language.
  useEffect(() => {
    if (state !== "on") return;
    void currentSubscription().then(sub => {
      const json = sub?.toJSON();
      if (json?.endpoint && json.keys) void supabase?.rpc("save_push_subscription", {device_endpoint: json.endpoint, key_p256dh: json.keys.p256dh, key_auth: json.keys.auth, device_lang: lang});
    });
  }, [lang, state]);

  async function turnOn() {
    setBusy(true); setError("");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") { setState(permission === "denied" ? "blocked" : "off"); return; }
      const registration = await navigator.serviceWorker.register("/sw.js", {scope: "/"});
      await navigator.serviceWorker.ready;
      const sub = await registration.pushManager.getSubscription() ?? await registration.pushManager.subscribe({userVisibleOnly: true, applicationServerKey: keyBytes(PUBLIC_KEY)});
      const json = sub.toJSON();
      const saved = await supabase!.rpc("save_push_subscription", {device_endpoint: json.endpoint, key_p256dh: json.keys!.p256dh, key_auth: json.keys!.auth, device_lang: lang});
      if (saved.error) throw new Error(saved.error.message);
      setState("on");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Notifications could not be turned on.");
    } finally {
      setBusy(false);
    }
  }
  async function turnOff() {
    setBusy(true); setError("");
    try {
      const sub = await currentSubscription();
      if (sub) {
        await supabase!.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
        await sub.unsubscribe();
      }
      setState("off");
    } finally {
      setBusy(false);
    }
  }

  if (state === "loading" || state === "unsupported") return null;
  return <div className="mt-6">
    <p className="eyebrow muted mb-2">Notifications</p>
    {state === "install" ? <p className="muted text-xs">On iPhone, tap Share, then Add to Home Screen. Open HEAT from there to turn on notifications.</p>
      : state === "blocked" ? <p className="muted text-xs">Notifications are blocked for HEAT. Allow them in your browser or phone settings, then come back.</p>
      : <button type="button" className={`nav-item ${state === "on" ? "active" : ""}`} aria-pressed={state === "on"} disabled={busy} onClick={() => void (state === "on" ? turnOff() : turnOn())}>
        {state === "on" ? <Bell size={19} /> : <BellOff size={19} />}{state === "on" ? "Notifications on" : "Turn on notifications"}
      </button>}
    {error && <p role="alert" className="muted mt-2 text-xs">{error}</p>}
  </div>;
}
