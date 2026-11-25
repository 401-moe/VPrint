import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, createPublicKey, verify } from "node:crypto";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const entry = fileURLToPath(new URL("../src/index.ts", import.meta.url));

function run(args, env) {
  return new Promise((resolve, reject) => {
    const binary = process.env.VPRINT_TEST_BINARY;
    const child = spawn(binary || process.execPath, binary ? args : [entry, ...args], {
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", chunk => { output += chunk; });
    child.stderr.on("data", chunk => { output += chunk; });
    child.once("error", reject);
    child.once("close", code => resolve({ code, output }));
  });
}

test("a denied device request shows the public code and saves no credentials", async t => {
  const dir = await mkdtemp(join(tmpdir(), "vprint-login-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const paths = [];
  const server = createServer((request, response) => {
    paths.push(request.url);
    response.setHeader("content-type", "application/json");
    if (request.url === "/api/auth/device/code") {
      response.end(JSON.stringify({
        device_code: "keep-this-device-code-private", user_code: "ABCD-EFGH",
        verification_uri: origin + "/device", expires_in: 30, interval: 1,
      }));
    } else {
      response.writeHead(400);
      response.end(JSON.stringify({ error: "access_denied" }));
    }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = "http://127.0.0.1:" + server.address().port;
  const result = await run(["login"], { VPRINT_URL: origin, VPRINT_CONFIG_DIR: dir });
  assert.notEqual(result.code, 0);
  assert.match(result.output, /ABCD-EFGH/);
  assert.match(result.output, /拒绝/);
  assert.equal(result.output.match(/等待浏览器授权/g)?.length, 1);
  assert.ok(!result.output.includes("\x1b"));
  assert.ok(result.output.includes(origin + "/device"));
  assert.ok(!result.output.includes("keep-this-device-code-private"));
  assert.deepEqual(paths, ["/api/auth/device/code", "/api/auth/oauth2/token"]);
  assert.deepEqual(await readdir(dir), []);
});

test("login, refresh in a new process, and logout use the same key and distinct proofs", async t => {
  const dir = await mkdtemp(join(tmpdir(), "vprint-grant-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const seen = [];
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const form = new URLSearchParams(Buffer.concat(chunks).toString());
    const route = req.url;
    seen.push({ route, form, headers: req.headers, method: req.method });
    res.setHeader("content-type", "application/json");
    if (route === "/api/auth/device/code") res.end(JSON.stringify({
      device_code: "private", user_code: "CDET", verification_uri: origin + "/device", expires_in: 30, interval: 1,
    }));
    else if (route === "/api/auth/oauth2/token") {
      const refreshed = form.get("grant_type") === "refresh_token";
      res.end(JSON.stringify({ access_token: refreshed ? "second" : "first", refresh_token: refreshed ? "next" : "initial", token_type: "DPoP", expires_in: refreshed ? 600 : 5 }));
    } else if (route === "/api/cli/me") res.end(JSON.stringify({ email: "runner@example.test" }));
    else if (route === "/api/cli/logout") { res.writeHead(204); res.end(); }
    else { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = "http://127.0.0.1:" + server.address().port;
  const env = { VPRINT_URL: origin, VPRINT_CONFIG_DIR: dir };
  const loggedIn = await run(["login"], env);
  assert.equal(loggedIn.code, 0, loggedIn.output);
  assert.match(loggedIn.output, /runner@example\.test/);
  if (process.platform !== "win32") assert.equal((await stat(join(dir, "session.json"))).mode & 0o777, 0o600);
  const loggedOut = await run(["logout"], env);
  assert.equal(loggedOut.code, 0, loggedOut.output);
  const alreadyLoggedOut = await run(["logout"], env);
  assert.equal(alreadyLoggedOut.code, 0, alreadyLoggedOut.output);
  assert.match(alreadyLoggedOut.output, /本机当前未登录/);
  assert.deepEqual(await readdir(dir), []);
  assert.deepEqual(seen.map(r => r.route), ["/api/auth/device/code", "/api/auth/oauth2/token", "/api/cli/me", "/api/auth/oauth2/token", "/api/cli/logout"]);
  assert.ok(seen[0].headers["x-vprint-hostname"]);
  assert.equal(seen[0].headers["x-vprint-os"], process.platform);
  assert.equal(seen[0].form.get("client_id"), "vprint-cli");
  assert.equal(seen[0].form.get("resource"), origin + "/api");
  assert.equal(seen[3].form.get("refresh_token"), "initial");
  const proofIds = new Set();
  let key;
  for (const item of seen.slice(1)) {
    const [head, payload, signature] = item.headers.dpop.split(".");
    const header = JSON.parse(Buffer.from(head, "base64url"));
    const claims = JSON.parse(Buffer.from(payload, "base64url"));
    assert.equal(header.alg, "ES256");
    assert.equal(header.jwk.d, undefined);
    key ??= header.jwk;
    assert.deepEqual(header.jwk, key);
    const publicKey = createPublicKey({ key, format: "jwk" });
    assert.ok(verify("sha256", Buffer.from(head + "." + payload), { key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(signature, "base64url")));
    assert.equal(claims.htu, origin + item.route);
    assert.equal(claims.htm, item.method);
    assert.ok(claims.jti && !proofIds.has(claims.jti));
    proofIds.add(claims.jti);
    if (item.route.startsWith("/api/cli/")) {
      const token = item.route.endsWith("/me") ? "first" : "second";
      assert.equal(item.headers.authorization, "DPoP " + token);
      assert.equal(claims.ath, createHash("sha256").update(token).digest("base64url"));
    }
  }
});
