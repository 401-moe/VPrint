import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { Monitor, Terminal } from "lucide-react";
import { toast } from "sonner";
import { Button } from "./components/ui/button";
import { openGithub } from "./GithubChoice";
import { api, ApiError } from "./api";

interface Session {
  id: string; type: "web" | "cli"; device: string; createdAt: number; expiresAt: number; current: boolean;
}

interface LinkedAccount {
  providerId: string;
  accountId: string;
}

const dateTimeFormat = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

function compactSessionName(userAgent: string) {
  const browser = /Edg(?:e|A|iOS)?\//.test(userAgent)
    ? "Edge"
    : /OPR\//.test(userAgent)
      ? "Opera"
      : /Firefox\//.test(userAgent)
        ? "Firefox"
        : /Chrome\//.test(userAgent)
          ? "Chrome"
          : /Safari\//.test(userAgent)
            ? "Safari"
            : "当前浏览器";
  const system = /Windows/.test(userAgent)
    ? "Windows"
    : /Android/.test(userAgent)
      ? "Android"
      : /(?:iPhone|iPad)/.test(userAgent)
        ? "iOS"
        : /Mac OS X/.test(userAgent)
          ? "macOS"
          : /Linux/.test(userAgent)
            ? "Linux"
            : "未知系统";
  return `${browser} · ${system}`;
}

function shortTime(value: number) {
  return dateTimeFormat.format(value);
}

export function AccountSettings({ email, name }: { email: string; name?: string }) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [hasPassword, setHasPassword] = useState<boolean | null>(null);
  const [githubLinked, setGithubLinked] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const passwordDialog = useRef<HTMLDialogElement>(null);
  const [passwordError, setPasswordError] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);
  const reload = useCallback(async () => {
    const [password, linkedAccounts, list] = await Promise.all([
      api<{ hasPassword: boolean }>("/api/account/password", undefined, "读取密码状态失败。"),
      api<LinkedAccount[]>("/api/auth/list-accounts", undefined, "读取关联账号失败。"),
      api<{ sessions: Session[] }>("/api/account/sessions", undefined, "读取会话失败。"),
    ]);
    setHasPassword(password.hasPassword);
    setGithubLinked(linkedAccounts.some(account => account.providerId === "github"));
    setSessions(list.sessions);
  }, []);
  useEffect(() => {
    const update = () => {
      void reload().catch(() => {
        setHasPassword(null);
        setGithubLinked(false);
        setSessions([]);
        setError("读取账号设置失败。");
      });
    };
    update();
    window.addEventListener("focus", update);
    return () => window.removeEventListener("focus", update);
  }, [reload]);

  async function revoke(session: Session) {
    setBusy(session.id); setError("");
    try {
      await api(`/api/account/sessions/${session.type}/${session.id}`, { method: "DELETE" }, "退出会话失败。")
        .catch(async cause => {
          if (!(cause instanceof ApiError && cause.status === 404)) throw cause;
        });
      if (session.current) window.location.replace("/");
      else await reload();
    } catch { setError("退出会话失败。"); }
    finally { setBusy(""); }
  }

  async function savePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (passwordBusy) return;
    const fields = new FormData(event.currentTarget);
    const password = String(fields.get("newPassword"));
    if (password !== fields.get("confirm")) {
      setPasswordError("两次输入的新密码不一致。");
      return;
    }
    setPasswordBusy(true); setPasswordError("");
    try {
      await api("/api/auth/change-password", {
        method: "POST",
        body: JSON.stringify({
          currentPassword: fields.get("currentPassword"),
          newPassword: password,
          revokeOtherSessions: true,
        }),
      }, "保存密码失败，请重试。");
      passwordDialog.current?.close();
      toast.success("密码已更新");
      await reload();
    } catch (cause) {
      passwordDialog.current?.querySelector<HTMLInputElement>('input[name="currentPassword"]')?.focus();
      setPasswordError(cause instanceof Error ? cause.message : "保存密码失败，请重试。");
    } finally {
      setPasswordBusy(false);
    }
  }

  return <div className="vp-settings">
    <header className="vp-heading">
      <div>
        <h1>账号设置</h1>
        <p className="account-identity"><span>{name}</span>{name && <span aria-hidden="true">·</span>}<span>{email}</span></p>
      </div>
    </header>
    <section className="vp-section account-methods" aria-labelledby="login-methods-title">
      <h2 id="login-methods-title">登录方式</h2>
      <div className="settings-panel account-method-list">
        <div className="account-login-method">
          <div>
            <h3>登录密码</h3>
            <p className="vp-meta">{hasPassword === null ? "正在读取密码状态…" : hasPassword ? "已设置密码登录" : "尚未设置密码，可通过邮箱验证码设置"}</p>
          </div>
          <Button type="button" variant="outline" className="settings-action" disabled={hasPassword === null}
            aria-haspopup={hasPassword ? "dialog" : undefined} aria-controls={hasPassword ? "account-password-dialog" : undefined}
            onClick={() => {
              if (hasPassword) passwordDialog.current?.showModal();
              else location.assign("/login?mode=reset&first=1&next=%2Faccount");
            }}>
            {hasPassword ? "修改密码" : "设置密码"}
          </Button>
        </div>
        <div className="account-login-method">
          <div><h3>GitHub 登录</h3><p className="vp-meta">{githubLinked ? "已关联" : "尚未关联"}</p></div>
          {!githubLinked && (
            <Button type="button" variant="outline" className="settings-action"
              onClick={() => openGithub("/account").catch(cause => setError(cause instanceof Error ? cause.message : "无法连接 GitHub。"))}>
              关联 GitHub
            </Button>
          )}
        </div>
      </div>
    </section>
    <section className="vp-section account-sessions" aria-labelledby="sessions-title">
      <h2 id="sessions-title">已登录会话 <span className="vp-tally">{sessions.length}</span></h2>
      <ul className="settings-panel session-list">{sessions.map(session => {
        const Icon = session.type === "cli" ? Terminal : Monitor;
        return <li className="vp-row session-row" key={session.type + session.id}>
          <Icon aria-hidden="true" />
          <div className="session-body">
            <div className="session-title">
              <strong>{session.type === "web" ? compactSessionName(session.device) : session.device}</strong>
              {session.current && <span className="settings-badge">当前会话</span>}
            </div>
            <div className="session-details">
              <span>{session.type === "cli" ? "CLI" : "Web"}</span>
              <time dateTime={new Date(session.createdAt).toISOString()}>{session.type === "cli" ? "授权" : "登录"} {shortTime(session.createdAt)}</time>
              <time dateTime={new Date(session.expiresAt).toISOString()}>到期 {shortTime(session.expiresAt)}</time>
            </div>
          </div>
          <Button type="button" variant="outline" className="settings-action"
            aria-label={`退出会话：${session.type === "web" ? compactSessionName(session.device) : session.device}`}
            disabled={!!busy || (passwordBusy && hasPassword === true)} onClick={() => revoke(session)}>
            退出
          </Button>
        </li>;
      })}</ul>
    </section>
    <dialog ref={passwordDialog} id="account-password-dialog" className="vp-dialog password-dialog" aria-labelledby="account-password-title"
      onCancel={event => { if (passwordBusy) event.preventDefault(); }}
      onClose={() => {
        passwordDialog.current?.querySelector("form")?.reset();
        setPasswordError("");
      }}>
      <h2 id="account-password-title">{hasPassword ? "修改密码" : "设置密码"}</h2>
      <form className="vp-form" onSubmit={savePassword} onChange={() => setPasswordError("")}>
        {hasPassword && <label className="vp-field">当前密码
          <input type="password" name="currentPassword" autoComplete="current-password" required />
        </label>}
        <label className="vp-field">新密码
          <input name="newPassword" type="password" autoComplete="new-password" minLength={8} maxLength={128} placeholder="8–128 个字符" required />
        </label>
        <label className="vp-field">确认新密码
          <input name="confirm" type="password" autoComplete="new-password" required />
        </label>
        <a className="password-recovery-link" href={`/login?mode=reset&next=${encodeURIComponent("/account")}`}>
          忘记当前密码？通过邮箱重置
        </a>
        {passwordError && <p className="vp-error" role="alert">{passwordError}</p>}
        <div className="vp-actions">
          <Button type="button" variant="outline" className="vp-secondary" disabled={passwordBusy} onClick={() => passwordDialog.current?.close()}>取消</Button>
          <Button type="submit" className="vp-primary" disabled={passwordBusy}>保存密码</Button>
        </div>
      </form>
    </dialog>
    {error && <p role="alert" className="vp-error">{error}</p>}
  </div>;
}
