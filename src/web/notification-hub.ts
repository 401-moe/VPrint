export type Interest = { contest: string; reader: boolean; visible: boolean; focusedAt: number };
export type TabNotice = { type: "reload" | "toast" | "ended"; id?: string };
type Tab = { interest: Interest; notify: (message: TabNotice) => void };

export class NotificationHub {
  private tabs = new Map<string, Tab>();
  private seen = new Map<string, Set<string>>();
  private initialized = new Set<string>();
  private socket: WebSocket | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private subscribed = "";
  private delay = 250;
  private ended = false;

  set(id: string, interest: Interest, notify: Tab["notify"]) {
    this.tabs.set(id, { interest, notify });
    if (this.ended) { notify({ type: "ended" }); return; }
    if (this.socket?.readyState === WebSocket.OPEN) this.sync();
    else if (!this.socket && !this.timer) this.connect();
  }

  remove(id: string) {
    this.tabs.delete(id);
    if (this.tabs.size) { this.sync(); return; }
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (!this.tabs.size) this.close();
      else if (!this.socket && !this.ended) this.connect();
    }, 250);
  }

  close() {
    clearTimeout(this.timer); this.timer = undefined;
    const socket = this.socket;
    this.socket = null;
    socket?.close();
    this.seen.clear();
    this.initialized.clear();
    this.subscribed = "";
  }

  private connect() {
    const url = new URL("/api/notifications", location.origin);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(url);
    this.socket = socket;
    socket.onopen = () => { this.delay = 250; this.subscribed = ""; this.sync(); };
    socket.onmessage = event => {
      if (this.socket !== socket) return;
      const data = JSON.parse(event.data);
      if (Array.isArray(data.subscribed)) {
        for (const contest of data.subscribed) void this.reconcile(contest, socket);
      } else if (typeof data.contestId === "string" && typeof data.printId === "string") {
        this.deliver(data.contestId, data.printId);
      }
    };
    socket.onclose = event => {
      if (this.socket !== socket) return;
      this.socket = null;
      if (event.code === 4001) {
        this.ended = true;
        for (const tab of this.tabs.values()) tab.notify({ type: "ended" });
      } else if (this.tabs.size) {
        this.timer = setTimeout(() => { this.timer = undefined; if (this.tabs.size) this.connect(); }, this.delay);
        this.delay = Math.min(10000, this.delay * 2);
      }
    };
  }

  private sync() {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    const contests = [...new Set(Array.from(this.tabs.values(), tab => tab.interest.contest))].sort();
    const message = JSON.stringify({ contests });
    if (this.subscribed !== message) this.socket.send(message);
    this.subscribed = message;
    for (const key of this.seen.keys()) if (!contests.includes(key)) { this.seen.delete(key); this.initialized.delete(key); }
  }

  private deliver(contest: string, id: string) {
    let known = this.seen.get(contest);
    if (!known) { known = new Set(); this.seen.set(contest, known); }
    if (known.has(id)) return;
    known.add(id);
    let recipient: Tab | undefined;
    for (const tab of this.tabs.values()) {
      if (tab.interest.contest !== contest) continue;
      if (!tab.interest.reader) tab.notify({ type: "reload" });
      else if (tab.interest.visible && (!recipient || recipient.interest.focusedAt < tab.interest.focusedAt)) recipient = tab;
    }
    recipient?.notify({ type: "toast", id });
  }

  private async reconcile(contest: string, socket: WebSocket) {
    try {
      const res = await fetch(`/api/contests/${contest}/prints`);
      if (!res.ok) return;
      const { printouts } = await res.json() as { printouts: { id: string }[] };
      if (this.socket !== socket || ![...this.tabs.values()].some(t => t.interest.contest === contest)) return;
      if (!this.initialized.has(contest)) {
        const known = this.seen.get(contest) ?? new Set<string>();
        for (const print of printouts) known.add(print.id);
        this.seen.set(contest, known);
        this.initialized.add(contest);
      } else for (const print of printouts.slice().reverse()) this.deliver(contest, print.id);
      for (const tab of this.tabs.values()) if (!tab.interest.reader && tab.interest.contest === contest) tab.notify({ type: "reload" });
    } catch { /* The next connection reconciles against D1 again. */ }
  }
}
