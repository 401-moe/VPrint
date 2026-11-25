import type { Readable, Writable } from "node:stream";
import { styleText } from "node:util";
import { SelectKeyPrompt } from "@clack/core";
import { log, S_INFO } from "@clack/prompts";

export const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY && !process.env.CI);

export function confirmPrint(input: Readable = process.stdin, output: Writable = process.stdout) {
  const prompt = new SelectKeyPrompt({
    input, output,
    options: [{ value: "y" }, { value: "n" }],
    caseSensitive: false,
    render: () => styleText("blue", S_INFO) + "  确认打印？ [Y/n]",
  });
  // SelectKeyPrompt's initialValue sets only the cursor. Enter submits value.
  prompt.value = "y";
  return prompt.prompt();
}

export function report(kind: "info" | "success" | "warn" | "error", message: string) {
  const output = kind === "error" ? process.stderr : process.stdout;
  log[kind](message, { output, withGuide: interactive && Boolean(output.isTTY), spacing: 0 });
}

export function errorMessage(error: unknown) {
  if (!(error instanceof Error)) return "VPrint 请求失败。";
  if (error.name === "TimeoutError") return "连接 VPrint 超时，请检查网络后重试。";
  if (error.message === "fetch failed" || (error as NodeJS.ErrnoException).code === "ECONNREFUSED") {
    return "无法连接 VPrint，请检查网络或服务地址。";
  }
  return error.message;
}
