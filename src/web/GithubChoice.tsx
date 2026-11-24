import { useEffect, useState } from "react";

interface Choice {
  login: string;
  email: string | null;
  canCreate: boolean;
  returnPath: string;
}

export async function openGithub(returnPath: string) {
  const response = await fetch("/api/auth/github/start", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ callbackURL: returnPath }),
  });
  const result = await response.json() as { url?: string; message?: string };
  if (!response.ok || !result.url) throw new Error(result.message ?? "暂时无法使用 GitHub 登录。");
  window.location.assign(result.url);
}

export function GithubChoice({ member }: { member: { email: string } | null }) {
  const [choice, setChoice] = useState<Choice | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (new URLSearchParams(location.search).has("occupied")) { setError("该 GitHub 身份已绑定其他 VPrint 账号。"); return; }
    const controller = new AbortController();
    fetch("/api/auth/github/choice", { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error("GitHub 授权已失效，请重新登录。");
        setChoice(await response.json() as Choice);
      })
      .catch(() => { if (!controller.signal.aborted) setError("GitHub 授权已失效，请重新登录。"); });
    return () => controller.abort();
  }, []);
  async function decide(action: "bind" | "cancel" | "create") {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/github/decision", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }),
      });
      const data = await response.json() as { returnPath?: string; message?: string };
      if (!response.ok || !data.returnPath) throw new Error(data.message || "操作失败，请重试。");
      window.location.replace(data.returnPath);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "网络异常，请重试。");
    } finally { setBusy(false); }
  }
  return <main className="shell"><section className="card">
    <h1 className="title">确认 GitHub 账号</h1>
    {choice && <>
      <p>GitHub 身份 <strong>{choice.login}</strong></p>
      {choice.email ? <>
        <p>已验证邮箱 <strong>{choice.email}</strong></p>
        {choice.canCreate && <button className="button" disabled={busy} onClick={() => decide("create")}>以此邮箱创建新账号</button>}
        {member
          ? <button className="button secondary" disabled={busy} onClick={() => decide("bind")}>确认绑定到 {member.email}</button>
          : <a className="button secondary" href="/github/choice?bind=1">绑定已有账号</a>}
      </> : <>
        <p>GitHub 未返回已验证的邮箱。</p>
        <button className="button" onClick={() => openGithub(choice.returnPath).catch(() => setError("无法重新授权。"))}>重新验证 GitHub</button>
        <a href={`/login?method=otp&next=${encodeURIComponent(choice.returnPath)}`}>使用邮箱验证码</a>
      </>}
      <button className="button secondary" disabled={busy} onClick={() => decide("cancel")}>取消</button>
    </>}
    {error && <p role="alert">{error}</p>}
    {!choice && error && <a href="/">返回登录</a>}
  </section></main>;
}
