import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const wrangler = fileURLToPath(new URL("../../node_modules/wrangler/bin/wrangler.js", import.meta.url));
const testFile = fileURLToPath(new URL("./preview.mjs", import.meta.url));
// An existing dev server must not satisfy this run's readiness check.
const listener = createServer().listen(0, "127.0.0.1");
await once(listener, "listening");
const port = String(listener.address().port);
const origin = "http://127.0.0.1:" + port;
await new Promise((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));
const state = ".wrangler/native-acceptance";
const migration = spawnSync(process.execPath, [wrangler, "d1", "migrations", "apply", "DB", "--local", "--persist-to", state], { stdio: "inherit" });
if (migration.status !== 0) throw new Error("Local D1 migration failed");
const server = spawn(process.execPath, [wrangler, "dev", "--ip", "127.0.0.1", "--port", port, "--inspector-port", "0", "--infer-origin-from-routes=false", "--persist-to", state,
  "--var", "BETTER_AUTH_URL:" + origin, "--var", "BETTER_AUTH_SECRET:local-native-test-only-secret-1234567890"], { stdio: "ignore" });
try {
  const deadline = Date.now() + 60000;
  for (;;) {
    if (server.exitCode !== null) throw new Error("Local Worker exited during startup");
    const response = await fetch(origin + "/api/me").catch(() => null);
    if (response?.status === 401) break;
    if (Date.now() > deadline) throw new Error("Local Worker did not start");
    await delay(200);
  }
  const smoke = spawn(process.execPath, [testFile], { stdio: "inherit", env: { ...process.env, VPRINT_ACCEPTANCE_ORIGIN: origin } });
  const status = await new Promise((resolve, reject) => { smoke.on("error", reject); smoke.on("close", resolve); });
  if (status !== 0) throw new Error("Native acceptance failed");
} finally {
  server.kill();
}
