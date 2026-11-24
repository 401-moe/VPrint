import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const root = process.cwd();
const port = Number(process.env.VPRINT_E2E_PORT ?? 8787);
const url = `http://127.0.0.1:${port}`;
const migrationArgs = [
  "d1",
  "migrations",
  "apply",
  "vprint-preview",
  "--local",
  "--persist-to",
  ".wrangler/browser-test",
];
const workerArgs = [
  "dev",
  "--port",
  String(port),
  "--persist-to",
  ".wrangler/browser-test",
  "--var",
  "BETTER_AUTH_SECRET:0123456789abcdef0123456789abcdef0123456789abcdef",
  "--var",
  `BETTER_AUTH_URL:${url}`,
];

let worker;

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";

    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      output += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(output);
      else reject(new Error(`${command} exited ${code}:\n${output}`));
    });
  });
}

export async function start() {
  await run("./node_modules/.bin/vite", ["build"]);
  await run("./node_modules/.bin/wrangler", migrationArgs);

  worker = spawn("./node_modules/.bin/wrangler", workerArgs, {
    cwd: root,
    env: process.env,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let workerOutput = "";
  worker.stdout.on("data", (chunk) => {
    workerOutput += chunk;
  });
  worker.stderr.on("data", (chunk) => {
    workerOutput += chunk;
  });

  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (worker.exitCode !== null) {
      throw new Error(`Wrangler exited ${worker.exitCode}:\n${workerOutput}`);
    }

    try {
      const response = await fetch(`${url}/api/me`);
      if (response.status === 401) return;
    } catch {
      // Wait for Wrangler's listener and D1 binding initialization.
    }

    await delay(100);
  }

  throw new Error(`Wrangler did not become ready:\n${workerOutput}`);
}

export async function stop() {
  if (!worker || worker.exitCode !== null) return;

  const terminate = (signal) => {
    try {
      process.kill(-worker.pid, signal);
      worker.kill(signal);
    } catch {
      // The process group already exited.
    }
  };

  terminate("SIGTERM");
  await Promise.race([
    new Promise((resolve) => worker.once("exit", resolve)),
    delay(1000, undefined, { ref: false }),
  ]);
  terminate("SIGKILL");
  if (worker.exitCode === null) {
    await new Promise((resolve) => worker.once("exit", resolve));
  }
}
