import { randomUUID } from "node:crypto";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function bindDirectory(contestId: string, directory = process.cwd()) {
  if (!uuid.test(contestId)) throw new Error("比赛标识无效。");
  const target = join(directory, ".vprint");
  const temp = target + "." + randomUUID();
  try {
    await writeFile(temp, JSON.stringify({ contestId }) + "\n", { flag: "wx" });
    await rename(temp, target);
  } finally {
    await rm(temp, { force: true });
  }
}

export async function findContest(start = process.cwd()): Promise<string> {
  let directory = resolve(start);
  for (;;) {
    const file = join(directory, ".vprint");
    let raw: string | undefined;
    try {
      raw = await readFile(file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (raw !== undefined) {
      try {
        const id = JSON.parse(raw)?.contestId;
        if (typeof id === "string" && uuid.test(id)) return id;
      } catch { /* Report the binding path for malformed JSON too. */ }
      throw new Error(file + " 内容无效，请在该目录重新运行 vprint use。");
    }
    const parent = dirname(directory);
    if (parent === directory) throw new Error("未找到 .vprint，请先运行 vprint use。");
    directory = parent;
  }
}
