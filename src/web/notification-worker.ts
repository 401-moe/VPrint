import { NotificationHub, type Interest } from "./notification-hub";

const hub = new NotificationHub();
const scope = self as unknown as { onconnect: (event: MessageEvent) => void };
scope.onconnect = event => {
  const port = event.ports[0];
  const id = crypto.randomUUID();
  port.onmessage = (message: MessageEvent<Interest | null>) => {
    if (message.data) hub.set(id, message.data, notice => port.postMessage(notice));
    else hub.remove(id);
  };
  port.addEventListener("close", () => hub.remove(id));
  port.start();
};
