import { useEffect, useRef } from "react";
import { NotificationHub, type Interest, type TabNotice } from "./notification-hub";

type Channel = { update: (interest: Interest) => void; close: () => void };

function connect(session: string, receive: (message: TabNotice) => void): Channel {
  if (typeof SharedWorker !== "undefined") {
    const worker = new SharedWorker(new URL("./notification-worker.ts", import.meta.url), { type: "module", name: "vprint-" + session });
    worker.port.onmessage = event => receive(event.data);
    return { update: interest => worker.port.postMessage(interest), close: () => { worker.port.postMessage(null); worker.port.close(); } };
  }
  // Browsers without SharedWorker elect one tab to host the same socket.
  const name = "vprint-notifications-" + session;
  const id = crypto.randomUUID();
  const channel = new BroadcastChannel(name);
  const abort = new AbortController();
  let hub: NotificationHub | undefined, last: Interest | undefined, release: (() => void) | undefined;
  function notify(key: string, notice: TabNotice) {
    if (key === id) receive(notice);
    else channel.postMessage({ to: key, notice });
  }
  function update(interest: Interest) {
    last = interest;
    if (hub) hub.set(id, interest, receive);
    else channel.postMessage({ id, interest });
  }
  channel.onmessage = ({ data }) => {
    if (data.hello && last) update(last);
    if (data.to === id) receive(data.notice);
    if (data.interest && hub) hub.set(data.id, data.interest, notice => notify(data.id, notice));
    if (data.left && hub) hub.remove(data.left);
  };
  void navigator.locks.request(name, { signal: abort.signal }, async () => {
    hub = new NotificationHub();
    if (last) hub.set(id, last, receive);
    channel.postMessage({ hello: true });
    await new Promise<void>(resolve => { release = resolve; });
    hub.close();
  }).catch(() => undefined);
  return { update, close: () => { channel.postMessage({ left: id }); channel.close(); abort.abort(); release?.(); } };
}

export function usePrintNotifications(contest: string, reader: boolean, receive: (notice: TabNotice) => void) {
  const handler = useRef(receive);
  handler.current = receive;
  const readMode = useRef(reader);
  readMode.current = reader;
  const refresh = useRef<() => void>(() => {});
  useEffect(() => { refresh.current(); }, [reader]);
  useEffect(() => {
    if (!contest) return;
    let active = true, channel: Channel | undefined;
    let focusedAt = document.hasFocus() ? Date.now() : 0;
    let epoch = 0;
    const update = () => channel?.update({ contest, reader: readMode.current, visible: document.visibilityState === "visible", focusedAt });
    refresh.current = update;
    const focus = () => { focusedAt = Date.now(); update(); };
    function stop() { epoch++; channel?.close(); channel = undefined; }
    async function start() {
      const generation = ++epoch;
      try {
        const result = await fetch("/api/notification-session");
        if (!result.ok) return;
        const { id } = await result.json() as { id: string };
        if (!active || epoch !== generation || channel) return;
        channel = connect(id, notice => {
          if (notice.type === "ended") window.location.reload();
          else handler.current(notice);
        });
        update();
      } catch { /* Reopening the page retries the subscription. */ }
    }
    void start();
    window.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", update);
    window.addEventListener("pagehide", stop);
    const restored = (event: PageTransitionEvent) => { if (event.persisted) void start(); };
    window.addEventListener("pageshow", restored);
    return () => {
      active = false; refresh.current = () => {}; stop();
      window.removeEventListener("focus", focus);
      document.removeEventListener("visibilitychange", update);
      window.removeEventListener("pagehide", stop);
      window.removeEventListener("pageshow", restored);
    };
  }, [contest]);
}
