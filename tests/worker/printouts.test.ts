import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll, expect, inject, test } from "vitest";
import { authorizeTestDevice } from "./authorized-device";
import worker from "../../src/worker/index";

const loopbackOrigin = "http://127.0.0.1:8787";

function request(path: string, init: RequestInit = {}) {
  return new Request(`${loopbackOrigin}${path}`, init);
}

function cookies(response: Response) {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
}

async function signUp(email: string) {
  const response = await worker.fetch(
    request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json", origin: loopbackOrigin },
      body: JSON.stringify({
        email,
        password: "correct horse battery staple",
        name: "队员",
      }),
    }),
    env,
  );
  if (!response.ok) throw new Error(`sign-up failed: ${response.status}`);
  return cookies(response);
}

async function createTeam(cookie: string) {
  const response = await worker.fetch(
    request("/api/teams", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ name: "火苗" }),
    }),
    env,
  );
  if (!response.ok) throw new Error(`team creation failed: ${response.status}`);
  return (await response.json()) as { id: string; invitationToken: string };
}

async function join(cookie: string, token: string) {
  const response = await worker.fetch(
    request(`/api/team-invitations/${token}/join`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: "{}",
    }),
    env,
  );
  if (!response.ok) throw new Error(`join failed: ${response.status}`);
}

async function createContest(cookie: string, teamId: string, name: string) {
  const response = await worker.fetch(
    request(`/api/teams/${teamId}/contests`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ name }),
    }),
    env,
  );
  if (!response.ok) throw new Error(`contest creation failed: ${response.status}`);
  return (await response.json()) as { id: string; createdAt: number };
}

async function member(cookie: string) {
  const response = await worker.fetch(request("/api/me", { headers: { cookie } }), env);
  return (await response.json()) as { id: string };
}

async function fixture(options: {
  ownerEmail: string;
  memberEmail: string;
  contestName: string;
}) {
  const ownerCookie = await signUp(options.ownerEmail);
  const memberCookie = await signUp(options.memberEmail);
  const team = await createTeam(ownerCookie);
  await join(memberCookie, team.invitationToken);
  const contest = await createContest(ownerCookie, team.id, options.contestName);
  return { ownerCookie, memberCookie, team, contest };
}

function printRequest(contestId: string, body: BodyInit, requestId = crypto.randomUUID()) {
  return request(`/api/cli/contests/${contestId}/prints`, {
    method: "POST",
    headers: {
      "content-type": "application/octet-stream",
      "idempotency-key": requestId,
      "x-vprint-filename": encodeURIComponent("A.cpp"),
    },
    body,
  });
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, inject("d1Migrations"));
});

test("team members can list printout metadata and open a separate body detail", async () => {
  const suffix = crypto.randomUUID();
  const { ownerCookie, memberCookie, contest } = await fixture({
    ownerEmail: `print-owner-${suffix}@vprint.example`,
    memberEmail: `print-member-${suffix}@vprint.example`,
    contestName: "周六训练",
  });
  const ownerId = (await member(ownerCookie)).id;
  const inserted = await env.DB.prepare(
    `
      INSERT INTO printout (id, contestId, userId, requestId, filename, content, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
  )
    .bind(
      crypto.randomUUID(),
      contest.id,
      ownerId,
      crypto.randomUUID(),
      "A.cpp",
      "return 0;\r\n",
      Date.now(),
    )
    .run();
  if (!inserted.success) throw new Error("printout fixture failed");

  const list = await worker.fetch(
    request(`/api/contests/${contest.id}/prints`, { headers: { cookie: memberCookie } }),
    env,
  );
  expect(list.status).toBe(200);
  const listBody = (await list.json()) as {
    printouts: { id: string; filename: string; createdAt: number; content?: unknown }[];
  };
  expect(listBody.printouts).toHaveLength(1);
  expect(listBody.printouts[0]).not.toHaveProperty("content");

  const detail = await worker.fetch(
    request(`/api/contests/${contest.id}/prints/${listBody.printouts[0].id}`, {
      headers: { cookie: memberCookie },
    }),
    env,
  );
  expect(detail.status).toBe(200);
  expect(await detail.json()).toMatchObject({ filename: "A.cpp", content: "return 0;\r\n" });
});

test("the same idempotency key returns the original receipt without a second row", async () => {
  const suffix = crypto.randomUUID();
  const { ownerCookie, contest } = await fixture({
    ownerEmail: `retry-owner-${suffix}@vprint.example`,
    memberEmail: `retry-member-${suffix}@vprint.example`,
    contestName: "重试训练",
  });
  const cli = await authorizeTestDevice(ownerCookie);
  const requestId = crypto.randomUUID();

  const first = await cli.send(
    printRequest(contest.id, "int first;\r\n", requestId),
  );
  expect(first.status).toBe(201);
  const receipt = (await first.json()) as { id: string; filename: string; createdAt: number };
  expect(receipt.filename).toBe("A.cpp");

  const retry = await cli.send(
    printRequest(contest.id, "different body after lost receipt", requestId),
  );
  expect(retry.status).toBe(200);
  expect(await retry.json()).toEqual(receipt);
  expect(
    await env.DB.prepare("SELECT COUNT(*) AS count FROM printout WHERE contestId = ?")
      .bind(contest.id)
      .first(),
  ).toEqual({ count: 1 });
});

test("print upload enforces streamed byte count and UTF-8 text without inserting", async () => {
  const suffix = crypto.randomUUID();
  const { ownerCookie, contest } = await fixture({
    ownerEmail: `validation-owner-${suffix}@vprint.example`,
    memberEmail: `validation-member-${suffix}@vprint.example`,
    contestName: "校验训练",
  });

  const cli = await authorizeTestDevice(ownerCookie);
  const oversized = await cli.send(
    printRequest(contest.id, new Uint8Array(65_537)),
  );
  expect(oversized.status).toBe(400);
  expect(await oversized.text()).toContain("单个文件最多 64 KiB");

  const invalid = await cli.send(
    printRequest(contest.id, Uint8Array.of(0xff, 0xfe, 0xfd)),
  );
  expect(invalid.status).toBe(400);
  expect(await invalid.text()).toContain("仅支持 UTF-8 纯文本");

  expect(
    await env.DB.prepare("SELECT COUNT(*) AS count FROM printout WHERE contestId = ?")
      .bind(contest.id)
      .first(),
  ).toEqual({ count: 0 });
});
