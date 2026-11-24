import { useCallback, useEffect, useState } from "react";
import { openGithub } from "./GithubChoice";

interface Session {
  id: string; type: "web" | "cli"; device: string; createdAt: number; expiresAt: number; current: boolean;
}

export function AccountSettings({ email }: { email: string }) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const reload = useCallback(async () => {
    const response = await fetch("/api/account/sessions");
    if (response.status === 401) { window.location.replace("/"); return; }
    if (!response.ok) throw new Error("读取会话失败。");
    const data = await response.json() as { sessions: Session[] };
    setSessions(data.sessions);
  }, []);
  useEffect(() => {
    const update = () => { void reload().catch(() => setError("读取会话失败。")); };
    update();
    window.addEventListener("focus", update);
    return () => window.removeEventListener("focus", update);
  }, [reload]);

  async function revoke(session: Session) {
    setBusy(session.id); setError("");
    try {
      const response = await fetch(`/api/account/sessions/${session.type}/${session.id}`, { method: "DELETE" });
      if (!response.ok && response.status !== 404) throw new Error("退出会话失败。");
      if (session.current) window.location.replace("/");
      else await reload();
    } catch { setError("退出会话失败。"); }
    finally { setBusy(""); }
  }

  return <main className="shell"><section className="workspace-card">
    <a href="/">返回工作台</a>
    <h1>账号设置</h1>
    <p>{email}</p>
    <button className="button secondary" onClick={() => openGithub("/account").catch(() => setError("无法连接 GitHub。"))}>关联 GitHub</button>
    <h2>已登录会话</h2>
    <ul className="session-list">{sessions.map(s => <li key={s.type + s.id}>
      <strong>{s.type === "cli" ? "CLI" : "Web"}{s.current && " · 当前会话"}</strong>
      <span className="session-device">{s.device}</span>
      <p>{s.type === "cli" ? "授权" : "登录"}于 {new Date(s.createdAt).toLocaleString("zh-CN")} · 到期于 {new Date(s.expiresAt).toLocaleString("zh-CN")}</p>
      <button type="button" className="button secondary" disabled={!!busy} onClick={() => revoke(s)}>退出此会话</button>
    </li>)}</ul>
    {error && <p role="alert">{error}</p>}
  </section></main>;
}
