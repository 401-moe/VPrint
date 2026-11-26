import { publishPrint } from "./notifications";
import { Hono } from "hono";
import { decodePrintText, maxPrintBytes } from "../shared/print-text";
import { getCurrentUser } from "./auth";
import { requireCliIdentity } from "./cli";
import type { Environment } from "./index";

interface TeamRow {
  id: string;
  name: string;
}

interface ContestRow {
  id: string;
  name: string;
  createdAt: number;
}

interface PrintoutRow {
  id: string;
  filename: string;
  createdAt: number;
  authorName: string | null;
}

function uuid(value: string) {
  return /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
    value,
  );
}

function decodedFilename(value: string | undefined) {
  if (!value) return null;
  try {
    const filename = decodeURIComponent(value);
    return filename.length > 0 && filename.length <= 255 && !/[\x00-\x1f\x7f/\\]/u.test(filename) ? filename : null;
  } catch {
    return null;
  }
}

async function readPrintBody(request: Request) {
  const chunks: Uint8Array[] = [];
  let byteCount = 0;
  const reader = request.body?.getReader();
  if (!reader) return { bytes: new Uint8Array(), error: null };

  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    byteCount += chunk.value.byteLength;
    if (byteCount > maxPrintBytes) {
      await reader.cancel();
      return { bytes: null, error: "单个文件最多 64 KiB。" };
    }
    chunks.push(chunk.value);
  }

  const bytes = new Uint8Array(byteCount);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { bytes, error: null };
}

export const printoutsRoutes = new Hono<{ Bindings: Environment }>();

printoutsRoutes.get("/cli/teams", async (context) => {
  const identity = await requireCliIdentity(context, ["vprint:teams:read"]);
  if (!identity) return context.json({ error: "authentication required" }, 401);
  const teams = await context.env.DB.prepare(
    `
      SELECT team.id, team.name
      FROM team_member
      JOIN team ON team.id = team_member.teamId
      WHERE team_member.userId = ?
      ORDER BY team.name, team.id
    `,
  )
    .bind(identity.user.id)
    .all<TeamRow>();
  return context.json({ teams: teams.results });
});

printoutsRoutes.get("/cli/teams/:teamId/contests", async (context) => {
  const teamId = context.req.param("teamId");
  const identity = await requireCliIdentity(context, ["vprint:teams:read"]);
  if (!identity) return context.json({ error: "authentication required" }, 401);
  const contests = await context.env.DB.prepare(
    `
      SELECT contest.id, contest.name, contest.createdAt
      FROM contest
      JOIN team_member ON team_member.teamId = contest.teamId
      WHERE contest.teamId = ? AND team_member.userId = ?
      ORDER BY contest.createdAt DESC, contest.id DESC
    `,
  )
    .bind(teamId, identity.user.id)
    .all<ContestRow>();
  return context.json({ contests: contests.results });
});

printoutsRoutes.get("/cli/contests/:contestId", async (context) => {
  const identity = await requireCliIdentity(context, ["vprint:teams:read"]);
  if (!identity) return context.json({ error: "authentication required" }, 401);
  const contest = await context.env.DB.prepare(`
    SELECT contest.name, contest.createdAt, team.name AS teamName
    FROM contest
    JOIN team ON team.id = contest.teamId
    JOIN team_member ON team_member.teamId = team.id
    WHERE contest.id = ? AND team_member.userId = ?
  `).bind(context.req.param("contestId"), identity.user.id)
    .first<{ name: string; createdAt: number; teamName: string }>();
  if (!contest) return context.json({ error: "contest not found" }, 403);
  return context.json(contest);
});

printoutsRoutes.post("/cli/contests/:contestId/prints", async (context) => {
  const contestId = context.req.param("contestId");
  const identity = await requireCliIdentity(context, ["vprint:print"]);
  if (!identity) return context.json({ error: "authentication required" }, 401);
  const requestId = context.req.header("idempotency-key");
  const filename = decodedFilename(context.req.header("x-vprint-filename"));
  if (!requestId || !uuid(requestId)) {
    return context.json({ error: "invalid idempotency key" }, 400);
  }
  if (!filename) return context.json({ error: "invalid filename" }, 400);

  const body = await readPrintBody(context.req.raw);
  if (!body.bytes) return context.json({ error: body.error }, 400);
  let text: string;
  try {
    text = decodePrintText(body.bytes);
  } catch (error) {
    const message = error instanceof Error ? error.message : "仅支持 UTF-8 纯文本。";
    return context.json({ error: message }, 400);
  }

  const id = crypto.randomUUID();
  const createdAt = Date.now();
  const [inserted, readback] = await context.env.DB.batch([
    context.env.DB.prepare(`
      INSERT INTO printout (id, contestId, userId, requestId, filename, content, createdAt)
      SELECT ?, c.id, m.userId, ?, ?, ?, ? FROM contest c
      JOIN team_member m ON m.teamId = c.teamId
      JOIN vprint_cli_grant g ON g.userId = m.userId
      WHERE c.id = ? AND m.userId = ? AND g.id = ? AND g.revokedAt IS NULL AND g.expiresAt > unixepoch()
      ON CONFLICT(userId, contestId, requestId) DO NOTHING
    `).bind(id, requestId, filename, text, createdAt, contestId, identity.user.id, identity.grantId),
    context.env.DB.prepare(`
      SELECT p.id, p.filename, p.createdAt FROM printout p
      JOIN contest c ON c.id = p.contestId
      JOIN team_member m ON m.teamId = c.teamId AND m.userId = p.userId
      JOIN vprint_cli_grant g ON g.userId = m.userId
      WHERE p.userId = ? AND p.contestId = ? AND p.requestId = ?
        AND g.id = ? AND g.revokedAt IS NULL AND g.expiresAt > unixepoch()
    `).bind(identity.user.id, contestId, requestId, identity.grantId),
  ]);
  if (inserted.meta.changes === 1) {
    await publishPrint(context.env, { contestId, printId: id }).catch(() => console.warn("Print notification delivery failed"));
  }
  const retry = readback.results[0];
  if (retry) return context.json(retry, inserted.meta.changes === 1 ? 201 : 200);
  return context.json({ error: "contest not found" }, 403);
});

printoutsRoutes.get("/contests/:contestId/prints", async (context) => {
  const user = await getCurrentUser(context.env, context.req.raw.headers);
  if (!user) return context.json({ error: "authentication required" }, 401);
  const contestId = context.req.param("contestId");
  const printouts = await context.env.DB.prepare(
    `
      SELECT printout.id, printout.filename, printout.createdAt, user.name AS authorName
      FROM printout
      JOIN contest ON contest.id = printout.contestId
      JOIN team_member ON team_member.teamId = contest.teamId
      LEFT JOIN user ON user.id = printout.userId
      WHERE printout.contestId = ? AND team_member.userId = ?
      ORDER BY printout.createdAt DESC, printout.id DESC
    `,
  )
    .bind(contestId, user.id)
    .all<PrintoutRow>();
  return context.json({ printouts: printouts.results });
});

printoutsRoutes.get("/contests/:contestId/prints/:printId", async (context) => {
  const user = await getCurrentUser(context.env, context.req.raw.headers);
  if (!user) return context.json({ error: "authentication required" }, 401);
  const contestId = context.req.param("contestId");
  const printId = context.req.param("printId");
  if (!uuid(contestId) || !uuid(printId)) {
    return context.text("", 404);
  }
  const printout = await context.env.DB.prepare(
    `
      SELECT printout.filename, printout.createdAt, printout.content, user.name AS authorName
      FROM printout
      JOIN contest ON contest.id = printout.contestId
      JOIN team_member ON team_member.teamId = contest.teamId
      LEFT JOIN user ON user.id = printout.userId
      WHERE printout.id = ? AND printout.contestId = ? AND team_member.userId = ?
    `,
  )
    .bind(printId, contestId, user.id)
    .first<{ filename: string; createdAt: number; content: string; authorName: string | null }>();
  if (!printout) return context.text("", 404);
  return context.json(printout);
});
