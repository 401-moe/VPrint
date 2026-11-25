import { randomUUID } from "node:crypto";
import { isCancel, select } from "@clack/prompts";
import { apiRequest } from "./auth.ts";
import { bindDirectory, findContest, uuidPattern } from "./binding.ts";
import { readPrintFile } from "./print-files.ts";
import { confirmPrint, errorMessage, interactive, report } from "./terminal.ts";

interface Choice { id: string; name: string; createdAt?: number }
interface UseOptions { team?: string; contest?: string }

function localTime(date: Date | number) {
  return new Date(date).toLocaleString("zh-CN", { hour12: false });
}

export function formatFileAge(ageMs: number) {
  let seconds = Math.floor(Math.abs(ageMs) / 1000);
  if (seconds === 0) return "0 秒前";
  const parts: string[] = [];
  for (const [unit, length] of [["天", 86400], ["小时", 3600], ["分钟", 60], ["秒", 1]] as const) {
    const count = Math.floor(seconds / length);
    if (count > 0) parts.push(`${count} ${unit}`);
    seconds %= length;
  }
  return parts.join(" ") + (ageMs < 0 ? "后" : "前");
}

function describe(item: Choice) {
  return item.createdAt === undefined ? item.name : item.name + "  " + localTime(item.createdAt);
}

async function choose(kind: "队伍" | "比赛", items: Choice[], selector: string | undefined) {
  if (selector !== undefined) {
    items = uuidPattern.test(selector)
      ? items.filter(item => item.id.toLowerCase() === selector.toLowerCase())
      : items.filter(item => item.name === selector);
    if (!items.length) throw new Error(`找不到${kind}「${selector}」，请核对名称或 ID。`);
    if (items.length === 1) return items[0];
    if (!interactive) {
      const matches = items.map(item => `  ${describe(item)}  ${item.id}`).join("\n");
      throw new Error(`${kind}「${selector}」有重名，请改用 ID：\n${matches}`);
    }
  } else if (kind === "队伍" && items.length === 1) {
    return items[0];
  }

  const selected = await select({
    message: `选择${kind}（↑↓ 移动，回车确认）`,
    showInstructions: false,
    options: items.map(item => ({ value: item, label: describe(item), hint: item.id })),
  });
  if (isCancel(selected)) throw new Error("已取消选择。");
  return selected;
}

export async function useContest(options: UseOptions) {
  if (!interactive && (options.team === undefined || options.contest === undefined)) {
    throw new Error("非交互模式需要同时提供 --team <名称或ID> 和 --contest <名称或ID>。");
  }
  const teamResponse = await apiRequest("/api/cli/teams");
  if (!teamResponse.ok) throw new Error("无法读取队伍，请检查账号权限。");
  const { teams } = await teamResponse.json() as { teams: Choice[] };
  if (!teams.length) throw new Error("请先在 Web 创建或加入队伍。");
  const team = await choose("队伍", teams, options.team);

  const response = await apiRequest("/api/cli/teams/" + encodeURIComponent(team.id) + "/contests");
  if (!response.ok) throw new Error("无法读取比赛，请检查队伍权限。");
  const { contests } = await response.json() as { contests: Choice[] };
  if (!contests.length) throw new Error("请先在 Web 为该队创建比赛。");
  const contest = await choose("比赛", contests, options.contest);
  await bindDirectory(contest.id);
  report("success", "已绑定 " + team.name + " / " + contest.name);
}

async function submitFile(endpoint: string, { bytes, filename }: Awaited<ReturnType<typeof readPrintFile>>) {
  const headers = new Headers({
    "content-type": "application/octet-stream",
    "idempotency-key": randomUUID(),
    "x-vprint-filename": encodeURIComponent(filename),
  });
  for (let attempt = 1; ; attempt++) {
    if (interactive && attempt > 1) report("info", `${filename} 尚未收到成功回执，正在重试（${attempt}/3）。`);
    let response: Response;
    try {
      response = await apiRequest(endpoint, "POST", headers, bytes);
      if (response.ok) {
        const receipt = await response.json() as { createdAt: number };
        report("success", filename + " 已打印  " + localTime(receipt.createdAt));
        return;
      }
    } catch (error) {
      if (attempt < 3 && (error instanceof TypeError || error instanceof SyntaxError ||
          (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)))) continue;
      throw error;
    }
    if (attempt < 3 && (response.status === 408 || response.status >= 500)) continue;
    if (response.status === 403) throw new Error("比赛不可访问，请运行 vprint use 重新选择。");
    throw new Error("服务器返回 HTTP " + response.status + "。");
  }
}

export async function printFile(path: string, yes: boolean) {
  const contestId = await findContest();
  const file = await readPrintFile(path).catch(error => {
    const reason = (error as NodeJS.ErrnoException).code === "ENOENT" ? "找不到文件。" : errorMessage(error);
    throw new Error(path + " 打印失败：" + reason);
  });
  const endpoint = "/api/cli/contests/" + contestId;
  const response = await apiRequest(endpoint);
  if (response.status === 403 || response.status === 404) throw new Error("比赛不可访问，请运行 vprint use 重新选择。");
  if (!response.ok) throw new Error("无法读取当前比赛，服务器返回 HTTP " + response.status + "。");
  const contest = await response.json() as { teamName: string; name: string; createdAt: number };
  const now = Date.now();
  report("info", [
    `当前比赛　${contest.teamName} / ${contest.name}（创建于 ${localTime(contest.createdAt)}）`,
    "当前时间　" + localTime(now),
    "文件名　　" + file.filename,
    "文件大小　" + file.bytes.byteLength + " 字节",
    `上次修改　${localTime(file.mtime)}（${formatFileAge(now - file.mtime.getTime())}）`,
  ].join("\n"));
  if (!yes) {
    if (!interactive) throw new Error("非交互模式需要 -y 或 --yes 确认打印。");
    const answer = await confirmPrint();
    if (answer !== "y") {
      report("info", "已取消打印。");
      if (isCancel(answer)) process.exitCode = 130;
      return;
    }
  }
  await submitFile(endpoint + "/prints", file);
}
