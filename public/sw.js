// HEAT's service worker. It only does two things: show a notification the server pushed, and open
// the app when someone taps one. No caching, so it can never serve a stale version of HEAT.
self.addEventListener("push", event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = {body: event.data ? event.data.text() : ""}; }
  event.waitUntil(self.registration.showNotification(data.title || "HEAT", {
    body: data.body || "",
    icon: "/apple-icon",
    badge: "/apple-icon",
    tag: data.tag,
    data: {url: data.url || "/app"},
  }));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/app";
  event.waitUntil(self.clients.matchAll({type: "window", includeUncontrolled: true}).then(windows => {
    const open = windows.find(w => new URL(w.url).pathname.startsWith("/app"));
    if (open) return open.focus();
    return self.clients.openWindow(url);
  }));
});
