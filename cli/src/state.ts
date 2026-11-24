import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import lockfile from "proper-lockfile";

export interface Credentials {
  version: 1;
  origin: string;
  privateKey: JsonWebKey;
  publicKey: JsonWebKey;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

function configDir() {
  if (process.env.VPRINT_CONFIG_DIR) return process.env.VPRINT_CONFIG_DIR;
  if (process.platform === "win32") return join(process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"), "VPrint");
  if (process.platform === "darwin") return join(homedir(), "Library", "Application Support", "VPrint");
  return join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "vprint");
}

const directory = configDir();
const file = join(directory, "session.json");

export async function readCredentials(origin: string): Promise<Credentials> {
  let contents;
  try {
    contents = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error("请先运行 vprint login。");
    throw error;
  }
  const session: Credentials = JSON.parse(contents);
  if (session.version !== 1 || session.origin !== origin) throw new Error("请为当前 VPrint 服务运行 vprint login。");
  return session;
}

export async function withCredentialLock<T>(action: () => Promise<T>) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const release = await lockfile.lock(directory, {
    lockfilePath: join(directory, "session.lock"),
    retries: { retries: 50, minTimeout: 100, maxTimeout: 500 },
  });
  try { return await action(); } finally { await release(); }
}

// Writers hold the directory lock so a rotated refresh token is never overwritten.
export async function writeCredentials(session: Credentials) {
  const temp = join(directory, randomUUID() + ".tmp");
  try {
    await writeFile(temp, JSON.stringify(session), { mode: 0o600, flag: "wx" });
    await rename(temp, file);
  } finally {
    await rm(temp, { force: true });
  }
}

export function clearCredentials() {
  return rm(file, { force: true });
}
