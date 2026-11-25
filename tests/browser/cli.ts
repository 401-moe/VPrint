import { type ChildProcess, spawn } from "node:child_process";
import { hostname } from "node:os";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const entry = resolve(fileURLToPath(new URL("../../cli/src/index.ts", import.meta.url)));

export interface CliProcess {
  child: ChildProcess;
  output: () => string;
  done: Promise<number | null>;
  stop: () => void;
}

export async function cliWorkspace() {
  const directory = await mkdtemp(join(tmpdir(), "vprint-browser-cli-"));
  return {
    directory,
    credentials: join(directory, "credentials"),
    close: () => rm(directory, { recursive: true, force: true }),
  };
}

export function runCli(
  args: string[],
  directory: string,
  origin: string,
  credentials: string,
): CliProcess {
  const binary = process.env.VPRINT_TEST_BINARY;
  const child = spawn(binary || process.execPath, binary ? args : [entry, ...args], {
    cwd: directory,
    env: { ...process.env, VPRINT_URL: origin, VPRINT_CONFIG_DIR: credentials },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", chunk => { output += chunk; });
  child.stderr.on("data", chunk => { output += chunk; });
  const done = new Promise<number | null>((resolveExit, reject) => {
    const timeout = setTimeout(() => child.kill(), 90_000);
    child.once("error", reject);
    child.once("close", code => {
      clearTimeout(timeout);
      resolveExit(code);
    });
  });
  return {
    child,
    output: () => output,
    done,
    stop: () => {
      if (child.exitCode === null && !child.killed) child.kill();
    },
  };
}

export async function waitUserCode(cli: CliProcess) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const code = cli.output().match(/短码[：:]?\s*([A-Z0-9-]+)/)?.[1];
    if (code) return code;
    if (cli.child.exitCode !== null) {
      await cli.done.catch(() => null);
      throw new Error("CLI login exited before showing its code: " + cli.output());
    }
    await new Promise(resolve => setTimeout(resolve, 80));
  }
  throw new Error("CLI login did not show its code");
}

export const firstSource = {
  filename: "solver.cpp",
  content: "#include <iostream>\n\nint main() {\n  int answer = 42;\n  std::cout << answer << '\\n';\n}\n",
};

export const localHostname = hostname();

export const secondSource = {
  filename: "reader.cpp",
  content: "int second() {\n  return 7;\n}\n",
};

export async function writeSources(directory: string) {
  await writeFile(join(directory, firstSource.filename), firstSource.content);
  await writeFile(join(directory, secondSource.filename), secondSource.content);
}
