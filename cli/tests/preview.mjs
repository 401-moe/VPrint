import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const origin = "https://vprint.401.moe";
const binary = resolve(process.env.VPRINT_TEST_BINARY);
const root = await mkdtemp(join(tmpdir(), "vprint-release-"));
const account = randomUUID();
const source = "int main() { return 0; }\n";
const api = async (path, cookie, body, method = body ? "POST" : "GET") => {
  const response = await fetch(origin + path, { method, headers: { cookie, origin, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  assert.ok(response.ok, method + " " + path.split("?")[0] + " returned " + response.status);
  return response;
};
async function register(role) {
  const r = await api("/api/auth/sign-up/email", "", { name: role, email: `${role}-${account}@example.test`, password: randomBytes(28).toString("hex") });
  return r.headers.getSetCookie().map(s => s.split(";")[0]).join("; ");
}
const children = new Set();
function run(args) {
  const child = spawn(binary, args, { cwd: root, env: { ...process.env, VPRINT_URL: origin, VPRINT_CONFIG_DIR: join(root, "credentials") }, stdio: ["pipe", "pipe", "pipe"] });
  children.add(child);
  let output = "";
  child.stdout.on("data", chunk => { output += chunk; });
  child.stderr.resume();
  const done = new Promise((res, rej) => {
    const timeout = setTimeout(() => child.kill(), 90000);
    child.on("error", rej);
    child.on("close", code => { clearTimeout(timeout); children.delete(child); code === 0 ? res() : rej(new Error("CLI command failed " + args[0])); });
  });
  return { child, output: () => output, done };
}
async function waitCode(cli) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const match = cli.output().match(/短码[：:]?\s*([A-Z0-9-]+)/);
    if (match) return match[1];
    await Promise.race([new Promise(res => setTimeout(res, 80)), cli.done.then(() => { throw new Error("Login ended before device approval"); })]);
  }
  throw new Error("Device code did not appear");
}
try {
  await mkdir(join(root, "credentials"), { mode: 0o700 });
  const host = await register("host"), teammate = await register("teammate");
  const team = await (await api("/api/teams", host, { name: "CLI release " + account })).json();
  const contest = await (await api(`/api/teams/${team.id}/contests`, host, { name: "训练" })).json();
  await api(`/api/team-invitations/${team.invitationToken}/join`, teammate, {});
  const login = run(["login"]);
  const code = await waitCode(login);
  const approval = await fetch(origin + "/api/cli/device/decision", { method: "POST", headers: { cookie: host, origin, "content-type": "application/json", "x-vprint-device-decision": "1" }, body: JSON.stringify({ userCode: code, approve: true, keepSignedIn: false }) });
  assert.equal(approval.status, 200);
  await login.done;
  const selection = run(["use"]);
  selection.child.stdin.end("1\n");
  await selection.done;
  assert.equal(JSON.parse(await readFile(join(root, ".vprint"), "utf8")).contestId, contest.id);
  await writeFile(join(root, "A.cpp"), source);
  await run(["A.cpp"]).done;
  await run(["A.cpp"]).done;
  const { printouts } = await (await api(`/api/contests/${contest.id}/prints`, teammate)).json();
  assert.equal(printouts.length, 2);
  const printed = await (await api(`/api/contests/${contest.id}/prints/${printouts[0].id}`, teammate)).json();
  assert.equal(printed.content, source);
  await run(["logout"]).done;
  console.log("Standalone CLI authorized, bound, printed twice in separate processes, and read back by teammate.");
} finally {
  for (const child of children) child.kill();
  await rm(root, { recursive: true, force: true });
}
