import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { apiRequest } from "./auth.ts";
import { bindDirectory, findContest } from "./binding.ts";
import { readPrintFile } from "./print-files.ts";

interface Team { id: string; name: string }
interface Contest extends Team { createdAt: number }

async function choose<T>(label: string, options: T[], describe: (item: T) => string, answers: AsyncIterator<string>) {
  console.log(label);
  options.forEach((item, i) => console.log("  " + (i + 1) + ". " + describe(item)));
  for (;;) {
    process.stdout.write("请输入序号：");
    const answer = await answers.next();
    if (answer.done) throw new Error("未完成选择。");
    const n = Number(answer.value.trim());
    if (Number.isInteger(n) && n >= 1 && n <= options.length) return options[n - 1];
    console.error("请输入 1 到 " + options.length + " 之间的序号。");
  }
}

export async function useContest() {
  const teamResponse = await apiRequest("/api/cli/teams");
  if (!teamResponse.ok) throw new Error("无法读取队伍，请检查账号权限。");
  const { teams } = await teamResponse.json() as { teams: Team[] };
  if (teams.length === 0) throw new Error("请先在 Web 创建或加入队伍。");
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  const answers = lines[Symbol.asyncIterator]();
  try {
    const team = teams.length === 1 ? teams[0] : await choose("选择队伍", teams, t => t.name, answers);
    const response = await apiRequest("/api/cli/teams/" + encodeURIComponent(team.id) + "/contests");
    if (!response.ok) throw new Error("无法读取比赛，请检查队伍权限。");
    const { contests } = await response.json() as { contests: Contest[] };
    if (!contests.length) throw new Error("请先在 Web 为该队创建比赛。");
    const contest = await choose("选择比赛", contests, item => item.name + "  " + new Date(item.createdAt).toLocaleString(), answers);
    await bindDirectory(contest.id);
    console.log("已绑定 " + team.name + " / " + contest.name);
  } finally {
    lines.close();
  }
}

async function submitFile(contestId: string, path: string) {
  const { bytes, filename } = await readPrintFile(path);
  const headers = new Headers({
    "content-type": "application/octet-stream",
    "idempotency-key": randomUUID(),
    "x-vprint-filename": encodeURIComponent(filename),
  });
  const endpoint = "/api/cli/contests/" + contestId + "/prints";
  for (let attempt = 1; ; attempt++) {
    let response: Response;
    try {
      response = await apiRequest(endpoint, "POST", headers, bytes);
      if (response.ok) {
        const receipt = await response.json() as { createdAt: number };
        console.log(filename + " 已打印  " + new Date(receipt.createdAt).toLocaleString());
        return;
      }
    } catch (error) {
      if (attempt < 3 && (error instanceof TypeError || error instanceof SyntaxError ||
          (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)))) continue;
      throw error;
    }
    if (attempt < 3 && (response.status === 408 || response.status >= 500)) continue;
    throw new Error("HTTP " + response.status);
  }
}

export async function printFiles(paths: string[]) {
  const contestId = await findContest();
  let failures = 0;
  for (const path of paths) {
    try { await submitFile(contestId, path); }
    catch (error) {
      failures++;
      console.error(path + " 打印失败：" + (error instanceof Error ? error.message : "请求失败"));
    }
  }
  console.log(`成功 ${paths.length - failures}，失败 ${failures}`);
  if (failures) process.exitCode = 1;
}
