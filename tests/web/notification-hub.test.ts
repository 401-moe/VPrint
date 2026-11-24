import { afterEach, expect, test, vi } from "vitest";
import { NotificationHub, type TabNotice } from "../../src/web/notification-hub";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

test("ten tabs share a socket, reconcile two contests and deliver missed IDs once on reconnect", async () => {
  vi.useFakeTimers();
  class Socket {
    static OPEN = 1;
    static instances: Socket[] = [];
    readyState = 0;
    sent: string[][] = [];
    onopen?: () => void;
    onmessage?: (e: {data: string}) => void;
    onclose?: (e: {code: number}) => void;
    constructor() { Socket.instances.push(this); }
    send(message: string) { this.sent.push(JSON.parse(message).contests); }
    open() { this.readyState = 1; this.onopen?.(); }
    message(data: unknown) { this.onmessage?.({ data: JSON.stringify(data) }); }
    close() { this.readyState = 3; this.onclose?.({ code: 1000 }); }
  }
  const rows = new Map([["A", ["first"]], ["B", [] as string[]]]);
  vi.stubGlobal("WebSocket", Socket);
  vi.stubGlobal("location", new URL("https://vprint.example"));
  vi.stubGlobal("fetch", async (path: string) => ({ ok: true, async json() {
    return { printouts: (rows.get(path.split("/")[3]) ?? []).map(id => ({ id })) };
  } }));
  const hub = new NotificationHub();
  const notices: string[] = [];
  const register = (n: number, contest: string) => hub.set(String(n), { contest, reader: n !== 0, visible: true, focusedAt: n }, (notice: TabNotice) => {
    if (notice.type === "toast") notices.push(n + ":" + notice.id);
  });
  for (let n = 0; n < 10; n++) register(n, "A");
  const [one] = Socket.instances;
  one.open(); one.message({ subscribed: ["A"] });
  await vi.advanceTimersByTimeAsync(1);
  expect(one.sent).toEqual([["A"]]);
  register(10, "B");
  expect(one.sent.at(-1)).toEqual(["A", "B"]);
  one.message({ contestId: "A", printId: "next" });
  one.message({ contestId: "A", printId: "next" });
  expect(notices).toEqual(["9:next"]);
  hub.remove("0");
  one.close();
  rows.set("A", ["missed", "next", "first"]);
  await vi.advanceTimersByTimeAsync(300);
  expect(Socket.instances).toHaveLength(2);
  const two = Socket.instances[1];
  two.open(); two.message({ subscribed: ["A", "B"] });
  await vi.advanceTimersByTimeAsync(1);
  expect(two.sent).toEqual([["A", "B"]]);
  expect(notices).toEqual(["9:next", "9:missed"]);
  for (let n = 1; n < 10; n++) hub.remove(String(n));
  expect(two.sent.at(-1)).toEqual(["B"]);
  hub.remove("10"); await vi.advanceTimersByTimeAsync(300);
  expect(two.readyState).toBe(3);
});
