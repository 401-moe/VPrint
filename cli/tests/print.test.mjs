import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const entry = fileURLToPath(new URL("../src/index.ts", import.meta.url));
const outerId = "9b43371b-e359-42db-8056-ef64dd65ac67";
const innerId = "78476318-47f3-4cf0-a374-5fbe6a2b8cf3";

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "vprint-files-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test("printing outside a bound directory explains vprint use before reading or connecting", async t => {
  const cwd = await fixture(t);
  const result = spawnSync(process.execPath, [entry, "A.cpp"], {
    cwd, encoding: "utf8", env: { ...process.env, VPRINT_URL: "http://127.0.0.1:1", VPRINT_CONFIG_DIR: cwd },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /vprint use/);
});

test("use writes a portable contest selection; the closest valid binding wins", async t => {
  const { bindDirectory, findContest } = await import("../src/binding.ts");
  const root = await fixture(t);
  const inner = join(root, "final"), source = join(inner, "solutions");
  await mkdir(source, { recursive: true });
  await bindDirectory(outerId, root);
  assert.equal(await findContest(source), outerId);
  await bindDirectory(innerId, inner);
  assert.equal(await findContest(source), innerId);
  assert.equal(await findContest(root), outerId);
  await writeFile(join(inner, ".vprint"), "{}");
  await assert.rejects(findContest(source), /\.vprint/);
});

test("extensionless UTF-8 input keeps all bytes and rejects over-limit and binary files", async t => {
  const { readPrintFile } = await import("../src/print-files.ts");
  const dir = await fixture(t), path = join(dir, "笔记");
  const content = Buffer.from("\uFEFF缩进\r\n\t迹\n", "utf8");
  await writeFile(path, content);
  assert.deepEqual(await readPrintFile(path), { filename: "笔记", bytes: content });
  await writeFile(path, Buffer.alloc(65_536, 65));
  assert.equal((await readPrintFile(path)).bytes.length, 65_536);
  await writeFile(path, Buffer.alloc(65_537, 65));
  await assert.rejects(readPrintFile(path), /64 KiB/);
  for (const invalid of [Buffer.from([0xc3, 0x28]), Buffer.from("PK\x03\x04")]) {
    await writeFile(path, invalid);
    await assert.rejects(readPrintFile(path), /UTF-8/);
  }
});

test("select a team and contest, restart under that directory, and print exact bytes", async t => {
  const root = await fixture(t);
  const config = join(root, "config"), practice = join(root, "practice"), subdir = join(practice, "solutions");
  await mkdir(config); await mkdir(subdir, { recursive: true });
  const received = [];
  let dropReceipt = false;
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    received.push({ url: req.url, headers: req.headers, body: Buffer.concat(chunks) });
    if (dropReceipt && req.url.endsWith("/prints")) { dropReceipt = false; return req.socket.destroy(); }
    res.setHeader("content-type", "application/json");
    if (req.url === "/api/cli/teams") res.end(JSON.stringify({ teams: [{ id: outerId, name: "早班" }, { id: innerId, name: "晚班" }] }));
    else if (req.url === "/api/cli/teams/" + innerId + "/contests") res.end(JSON.stringify({ contests: [{ id: innerId, name: "决赛", createdAt: 1000 }] }));
    else if (req.url === "/api/cli/contests/" + innerId + "/prints") res.end(JSON.stringify({ id: "receipt", createdAt: 2000 }));
    else { res.writeHead(404); res.end("{}"); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = "http://127.0.0.1:" + server.address().port;
  const keys = generateKeyPairSync("ec", { namedCurve: "P-256" });
  await writeFile(join(config, "session.json"), JSON.stringify({
    version: 1, origin, accessToken: "fixture", refreshToken: "fixture-refresh", expiresAt: Date.now() + 60_000,
    publicKey: keys.publicKey.export({ format: "jwk" }), privateKey: keys.privateKey.export({ format: "jwk" }),
  }));
  async function invoke(args, cwd, input = "", expected = 0) {
    const bin = process.env.VPRINT_TEST_BINARY;
    const child = spawn(bin || process.execPath, bin ? args : [entry, ...args], {
      cwd, env: { ...process.env, VPRINT_URL: origin, VPRINT_CONFIG_DIR: config },
    });
    let output = "";
    child.stdout.on("data", chunk => { output += chunk; });
    child.stderr.on("data", chunk => { output += chunk; });
    child.stdin.end(input);
    const status = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
    assert.equal(status, expected, output);
    return output;
  }
  assert.match(await invoke(["use"], practice, "2\n1\n"), /已绑定 晚班 \/ 决赛/);
  assert.deepEqual(JSON.parse(await readFile(join(practice, ".vprint"), "utf8")), { contestId: innerId });
  const source = Buffer.from("\uFEFF\t解题\r\n", "utf8");
  await writeFile(join(subdir, "笔记"), source);
  assert.match(await invoke(["笔记"], subdir), /笔记 已打印/);
  assert.equal(received.length, 3);
  const upload = received[2];
  assert.deepEqual(upload.body, source);
  assert.equal(decodeURIComponent(upload.headers["x-vprint-filename"]), "笔记");
  assert.ok(upload.headers["idempotency-key"]);
  assert.ok(received.every(r => r.headers.dpop && r.headers.authorization === "DPoP fixture"));
  dropReceipt = true;
  const batch = await invoke(["笔记", "missing.cpp", "笔记"], subdir, "", 1);
  assert.match(batch, /成功 2，失败 1/);
  const [lost, retried, manual] = received.slice(3);
  assert.equal(lost.headers["idempotency-key"], retried.headers["idempotency-key"]);
  assert.notEqual(lost.headers.dpop, retried.headers.dpop);
  assert.notEqual(manual.headers["idempotency-key"], lost.headers["idempotency-key"]);

});
