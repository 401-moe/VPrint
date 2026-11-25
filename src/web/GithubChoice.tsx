import { useEffect, useState } from "react";
import { Button } from "./components/ui/button";
import { Header } from "./Shell";
import { api } from "./api";

interface Choice {
  login: string;
  email: string | null;
  canCreate: boolean;
  returnPath: string;
}

export async function openGithub(returnPath: string) {
  const result = await api<{ url: string }>("/api/auth/github/start", {
    method: "POST", body: JSON.stringify({ callbackURL: returnPath }),
  }, "暂时无法使用 GitHub 登录。");
  window.location.assign(result.url);
}

export function GithubChoice({ member }: { member: { email: string } | null }) {
  const [choice, setChoice] = useState<Choice | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (new URLSearchParams(location.search).has("occupied")) { setError("该 GitHub 身份已绑定其他 VPrint 账号。"); return; }
    const controller = new AbortController();
    api<Choice>("/api/auth/github/choice", { signal: controller.signal })
      .then(value => { if (!controller.signal.aborted) setChoice(value); })
      .catch(() => { if (!controller.signal.aborted) setError("GitHub 授权已失效，请重新登录。"); });
    return () => controller.abort();
  }, []);
  async function decide(action: "bind" | "cancel" | "create") {
    setBusy(true);
    setError("");
    try {
      const data = await api<{ returnPath: string }>("/api/auth/github/decision", {
        method: "POST", body: JSON.stringify({ action }),
      }, "操作失败，请重试。");
      window.location.replace(data.returnPath);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "网络异常，请重试。");
    } finally { setBusy(false); }
  }
  return <>
    <Header />
    <div className="vp-standalone">
      <main className="vp-auth-main"><div className="identity-page">
        <header className="vp-heading identity-heading"><div>
          <h1>确认 GitHub 账号</h1>
          <p>使用这个 GitHub 身份继续登录 VPrint。</p>
        </div></header>
        <section className="vp-panel identity-panel">
          {choice ? <>
            <div className="vp-meta identity-identity"><span><strong>{choice.login}</strong></span><span>{choice.email ?? "GitHub 未返回已验证邮箱"}</span></div>
            <div className="identity-submit">
            {choice.email ? <>
              {choice.canCreate && <Button className="vp-primary" disabled={busy} onClick={() => decide("create")}>以此邮箱创建新账号</Button>}
              {member
                ? <Button variant="outline" className="vp-secondary" disabled={busy} onClick={() => decide("bind")}>确认绑定到 {member.email}</Button>
                : <Button variant="outline" className="vp-secondary" disabled={busy} onClick={() => location.replace("/github/choice?bind=1")}>绑定已有账号</Button>}
            </> : <>
              <p className="vp-note">请先在 GitHub 验证邮箱，然后重新授权；或改用 VPrint 邮箱验证码。</p>
              <Button className="vp-primary" disabled={busy} onClick={() => openGithub(choice.returnPath).catch(() => setError("无法重新授权。"))}>重新验证 GitHub</Button>
              <a className="vp-text-action" href={`/login?method=otp&next=${encodeURIComponent(choice.returnPath)}`}>使用邮箱验证码</a>
            </>}
            <Button variant="outline" className="vp-secondary" disabled={busy} onClick={() => decide("cancel")}>取消</Button>
            </div>
          </> : <p className="vp-meta" role={error ? "alert" : "status"}>{error || "正在读取 GitHub 授权结果…"}</p>}
          {choice && error && <p className="vp-error" role="alert">{error}</p>}
          {!choice && error && <a className="vp-text-action" href="/">返回登录</a>}
        </section>
      </div></main>
    </div>
  </>;
}
