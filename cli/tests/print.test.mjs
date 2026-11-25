import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";
import { S_INFO } from "@clack/prompts";

const entry = fileURLToPath(new URL("../src/index.ts", import.meta.url));
const outerId = "9b43371b-e359-42db-8056-ef64dd65ac67";
const innerId = "78476318-47f3-4cf0-a374-5fbe6a2b8cf3";

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "vprint-files-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test("the one-line print confirmation defaults to yes and accepts either case immediately", async () => {
  const { confirmPrint } = await import("../src/terminal.ts");
  for (const [key, expected] of [["\r", "y"], ["y", "y"], ["Y", "y"], ["n", "n"], ["N", "n"]]) {
    const input = new PassThrough(), output = new PassThrough();
    let rendered = "";
    output.on("data", chunk => { rendered += chunk; });
    const answer = confirmPrint(input, output);
    const expectedLine = S_INFO + "  确认打印？ [Y/n]";
    assert.equal(stripVTControlCharacters(rendered), expectedLine);
    input.write(key);
    assert.equal(await answer, expected);
    assert.equal(stripVTControlCharacters(rendered).trimEnd(), expectedLine);
    input.end();
  }
});

test("modification age uses whole seconds and keeps days as its largest unit", async () => {
  const { formatFileAge } = await import("../src/printing.ts");
  for (const [seconds, expected] of [
    [0, "0 秒前"], [59.999, "59 秒前"], [60, "1 分钟前"], [2082, "34 分钟 42 秒前"],
    [3600, "1 小时前"], [86400, "1 天前"], [366 * 86400 + 3723, "366 天 1 小时 2 分钟 3 秒前"],
    [-62, "1 分钟 2 秒后"],
  ]) assert.equal(formatFileAge(seconds * 1000), expected);
});

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
  assert.deepEqual(await readPrintFile(path), { filename: "笔记", bytes: content, mtime: (await stat(path)).mtime });
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
  const teams = [{ id: outerId, name: "早班" }, { id: innerId, name: "晚班" }];
  const contests = [{ id: innerId, name: "决赛", createdAt: 2000 }];
  let dropReceipt = false, canReadContest = true;
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    received.push({ url: req.url, headers: req.headers, body: Buffer.concat(chunks) });
    if (dropReceipt && req.url.endsWith("/prints")) { dropReceipt = false; return req.socket.destroy(); }
    res.setHeader("content-type", "application/json");
    if (req.url === "/api/cli/teams") res.end(JSON.stringify({ teams }));
    else if (req.url === "/api/cli/teams/" + innerId + "/contests") res.end(JSON.stringify({ contests }));
    else if (req.url === "/api/cli/contests/" + innerId && canReadContest) res.end(JSON.stringify({ ...contests[0], teamName: "晚班" }));
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
  async function invoke(args, cwd, expected = 0) {
    const bin = process.env.VPRINT_TEST_BINARY;
    const child = spawn(bin || process.execPath, bin ? args : [entry, ...args], {
      cwd, env: { ...process.env, VPRINT_URL: origin, VPRINT_CONFIG_DIR: config },
    });
    let output = "";
    child.stdout.on("data", chunk => { output += chunk; });
    child.stderr.on("data", chunk => { output += chunk; });
    child.stdin.end();
    const status = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
    assert.equal(status, expected, output);
    return output;
  }
  assert.match(await invoke(["use", "--team", "晚班", "--contest", "决赛"], practice), /已绑定 晚班 \/ 决赛/);
  assert.deepEqual(JSON.parse(await readFile(join(practice, ".vprint"), "utf8")), { contestId: innerId });
  const requestsBeforeExtraArgs = received.length;
  for (const command of ["login", "logout", "use"]) {
    assert.match(await invoke([command, "extra"], practice, 1), /too many arguments/);
  }
  assert.equal(received.length, requestsBeforeExtraArgs);
  const source = Buffer.from("\uFEFF\t解题\r\n", "utf8");
  await writeFile(join(subdir, "笔记"), source);
  const stamp = new Date(2026, 2, 4, 15, 6, 7);
  await utimes(join(subdir, "笔记"), stamp, stamp);
  const before = received.length;
  assert.match(await invoke(["-y", "笔记", "missing.cpp"], subdir, 1), /每次只能打印一个文件/);
  assert.equal(received.length, before);
  assert.match(await invoke(["笔记"], subdir, 1), /非交互模式需要 -y 或 --yes/);
  assert.equal(received.filter(r => r.url.endsWith("/prints")).length, 0);
  const output = await invoke(["-y", "笔记"], subdir);
  for (const part of ["当前比赛　晚班 / 决赛", "当前时间", "文件名　　笔记", "文件大小　" + source.length + " 字节",
    "上次修改　" + stamp.toLocaleString("zh-CN", { hour12: false }) + "（", "笔记 已打印"]) assert.ok(output.includes(part), output);
  assert.doesNotMatch(output, /\[Y\/n\]/);
  const upload = received.at(-1);
  assert.deepEqual(upload.body, source);
  assert.equal(decodeURIComponent(upload.headers["x-vprint-filename"]), "笔记");
  assert.ok(upload.headers["idempotency-key"]);
  assert.ok(received.every(r => r.headers.dpop && r.headers.authorization === "DPoP fixture"));
  dropReceipt = true;
  await invoke(["笔记", "--yes"], subdir);
  await invoke(["--yes", "笔记"], subdir);
  const [lost, retried, manual] = received.filter(r => r.url.endsWith("/prints")).slice(1);
  assert.equal(lost.headers["idempotency-key"], retried.headers["idempotency-key"]);
  assert.notEqual(lost.headers.dpop, retried.headers.dpop);
  assert.notEqual(manual.headers["idempotency-key"], lost.headers["idempotency-key"]);
  contests[0].name = "决赛\n下午场";
  const escapedName = "决赛\\u000a下午场";
  assert.ok((await invoke(["use", "--team", innerId, "--contest", contests[0].name], practice)).includes(escapedName));
  assert.ok((await invoke(["-y", "笔记"], subdir)).includes("当前比赛　晚班 / " + escapedName));
  contests[0].name = "决赛";
  for (const literal of ["login", "-y"]) {
    await writeFile(join(subdir, literal), source);
    await invoke(["-y", "--", literal], subdir);
    assert.equal(received.at(-1).headers["x-vprint-filename"], literal);
  }
  canReadContest = false;
  assert.match(await invoke(["-y", "笔记"], subdir, 1), /比赛不可访问/);
  assert.equal(received.at(-1).url, "/api/cli/contests/" + innerId);

  // The same display names can identify different teams and different contests.
  teams[0].name = "晚班";
  const otherTeamContestId = "414c7254-10fb-465a-a29c-257db0d86236";
  contests.push({ id: outerId, name: "决赛", createdAt: 1000 });
  contests.push({ id: "293b4150-7eda-4f5b-bfec-53b84d3af26b", name: otherTeamContestId, createdAt: 500 });
  for (const args of [[], ["--team", innerId], ["--contest", innerId]]) {
    assert.match(await invoke(["use", ...args], practice, 1), /非交互模式/);
  }
  for (const [team, contest, message] of [
    ["晚班", "决赛", /队伍「晚班」有重名/],
    [innerId, "决赛", /比赛「决赛」有重名/],
  ]) {
    const output = await invoke(["use", "--team", team, "--contest", contest], practice, 1);
    assert.match(output, message);
    assert.ok(output.includes(innerId) && output.includes(outerId));
  }
  for (const [team, contest, message] of [
    ["不存在", innerId, /找不到队伍/],
    [innerId, "不存在", /找不到比赛/],
    [innerId, otherTeamContestId, /找不到比赛/],
  ]) {
    assert.match(await invoke(["use", "--team", team, "--contest", contest], practice, 1), message);
  }
  const binding = join(practice, ".vprint");
  assert.deepEqual(JSON.parse(await readFile(binding, "utf8")), { contestId: innerId });
  await invoke(["use", "--team", innerId, "--contest", outerId], practice);
  assert.deepEqual(JSON.parse(await readFile(binding, "utf8")), { contestId: outerId });

});
