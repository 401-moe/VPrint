import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, LogOut, Monitor, Terminal } from "lucide-react";
import { toast } from "sonner";
import { api, ApiError } from "./api";
import { openGithub } from "./GithubChoice";
import { Button, buttonClassName } from "./ui/button";
import { DialogContent, DialogRoot } from "./ui/dialog";
import { CredentialInput } from "./ui/input";

interface Session {
  id: string;
  type: "web" | "cli";
  device: string;
  createdAt: number;
  expiresAt: number;
  current: boolean;
}

interface LinkedAccount {
  providerId: string;
  accountId: string;
}

const dateTimeFormat = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
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

export function AccountSettings({
  email,
  name,
  pending = false,
  signOut,
}: {
  email: string;
  name?: string;
  pending?: boolean;
  signOut: () => void;
}) {
  const [settings, setSettings] = useState<{
    hasPassword: boolean;
    githubLinked: boolean;
    sessions: Session[];
  }>();
  const [loadFailed, setLoadFailed] = useState(false);
  const loadVersion = useRef(0);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [passwordError, setPasswordError] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);
  const currentPasswordRef = useRef<HTMLInputElement>(null);

  const reload = useCallback(async () => {
    const version = ++loadVersion.current;
    setLoadFailed(false);
    try {
      const [password, accounts, list] = await Promise.all([
        api<{ hasPassword: boolean }>("/api/account/password"),
        api<LinkedAccount[]>("/api/auth/list-accounts"),
        api<{ sessions: Session[] }>("/api/account/sessions"),
      ]);
      if (version === loadVersion.current) {
        setSettings({
          hasPassword: password.hasPassword,
          githubLinked: accounts.some(
            (account) => account.providerId === "github",
          ),
          sessions: list.sessions,
        });
      }
    } catch {
      if (version === loadVersion.current) setLoadFailed(true);
    }
  }, []);

  useEffect(() => {
    void reload();
    window.addEventListener("focus", reload);
    return () => {
      loadVersion.current++;
      window.removeEventListener("focus", reload);
    };
  }, [reload]);

  async function revoke(session: Session) {
    setBusy(session.id);
    setError("");
    try {
      await api(
        `/api/account/sessions/${session.type}/${session.id}`,
        { method: "DELETE" },
        "退出会话失败。",
      ).catch((cause) => {
        if (!(cause instanceof ApiError && cause.status === 404)) throw cause;
      });
      if (session.current) window.location.replace("/login");
      else await reload();
    } catch {
      setError("退出会话失败。");
    } finally {
      setBusy("");
    }
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
    setPasswordBusy(true);
    setPasswordError("");
    try {
      await api(
        "/api/auth/change-password",
        {
          method: "POST",
          body: JSON.stringify({
            currentPassword: fields.get("currentPassword"),
            newPassword: password,
            revokeOtherSessions: true,
          }),
        },
        "保存密码失败，请重试。",
      );
      setPasswordOpen(false);
      toast.success("密码已更新");
      await reload();
    } catch (cause) {
      currentPasswordRef.current?.focus();
      setPasswordError(
        cause instanceof Error ? cause.message : "保存密码失败，请重试。",
      );
    } finally {
      setPasswordBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-[760px] px-4 py-8 sm:px-6 space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <a
            href="/workspace"
            className={buttonClassName({
              variant: "ghost",
              compact: true,
              className: "-ml-2 mb-1",
            })}
          >
            <ArrowLeft size={14} aria-hidden="true" />
            <span>返回我的队伍</span>
          </a>
          <h1 className="text-[22px] sm:text-[24px] font-semibold tracking-[-0.02em] leading-[1.25] text-[var(--text)]">
            账号设置
          </h1>
          <p className="mt-1 text-[13px] text-[var(--muted)]">
            {name}
            {name && " · "}
            {email}
          </p>
        </div>
        <Button variant="secondary" disabled={pending} onClick={signOut}>
          <LogOut size={14} aria-hidden="true" />
          <span>退出登录</span>
        </Button>
      </div>

      {loadFailed && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-card)] border border-[var(--negative)]/35 bg-[var(--surface)] px-5 py-4 text-[13px] text-[var(--negative)]"
        >
          <span>读取账号设置失败。</span>
          <Button variant="secondary" compact onClick={() => void reload()}>
            重新加载
          </Button>
        </div>
      )}

      {!settings && !loadFailed && (
        <p role="status" className="text-[13px] text-[var(--muted)]">
          正在读取账号设置…
        </p>
      )}

      {settings && (
        <>
          <section
            className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] overflow-hidden"
            aria-labelledby="login-methods-title"
          >
            <div className="border-b border-[var(--rule)] px-5 py-3.5">
              <h2
                id="login-methods-title"
                className="text-[14px] font-semibold text-[var(--text)]"
              >
                登录方式
              </h2>
            </div>
            <div className="divide-y divide-[var(--rule)]">
              <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                <div>
                  <h3 className="text-[14px] font-medium text-[var(--text)]">
                    登录密码
                  </h3>
                  <p className="mt-0.5 text-[13px] text-[var(--muted)]">
                    {settings.hasPassword
                      ? "已设置密码登录"
                      : "尚未设置密码，可通过邮箱验证码设置"}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  aria-haspopup={settings.hasPassword ? "dialog" : undefined}
                  aria-controls={
                    settings.hasPassword ? "account-password-dialog" : undefined
                  }
                  onClick={() => {
                    if (settings.hasPassword) {
                      setPasswordError("");
                      setPasswordOpen(true);
                    } else {
                      location.assign(
                        "/login?mode=reset&first=1&next=%2Faccount",
                      );
                    }
                  }}
                >
                  {settings.hasPassword ? "修改密码" : "设置密码"}
                </Button>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                <div>
                  <h3 className="text-[14px] font-medium text-[var(--text)]">
                    GitHub 登录
                  </h3>
                  <p className="mt-0.5 text-[13px] text-[var(--muted)]">
                    {settings.githubLinked ? "已关联" : "尚未关联"}
                  </p>
                </div>
                {!settings.githubLinked && (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() =>
                      void openGithub("/account").catch((cause) =>
                        setError(
                          cause instanceof Error
                            ? cause.message
                            : "无法连接 GitHub。",
                        ),
                      )
                    }
                  >
                    关联 GitHub
                  </Button>
                )}
              </div>
            </div>
          </section>

          <section
            className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] overflow-hidden"
            aria-labelledby="sessions-title"
          >
            <div className="border-b border-[var(--rule)] px-5 py-3.5">
              <h2
                id="sessions-title"
                className="text-[14px] font-semibold text-[var(--text)] vp-num"
              >
                已登录会话 ({settings.sessions.length})
              </h2>
            </div>
            <ul className="divide-y divide-[var(--rule)]">
              {settings.sessions.map((session) => {
                const Icon = session.type === "cli" ? Terminal : Monitor;
                const displayName =
                  session.type === "web"
                    ? compactSessionName(session.device)
                    : session.device;
                return (
                  <li
                    className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5"
                    key={session.type + session.id}
                  >
                    <div className="flex min-w-0 items-start gap-3">
                      <Icon
                        size={16}
                        className="mt-0.5 shrink-0 text-[var(--muted)]"
                        aria-hidden="true"
                      />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2 text-[14px] font-medium text-[var(--text)]">
                          <strong>{displayName}</strong>
                          <span className="rounded-[var(--radius-control)] border border-[var(--border)] px-1.5 py-0.5 text-[11px] uppercase text-[var(--muted)]">
                            {session.type === "cli" ? "CLI" : "Web"}
                          </span>
                          {session.current && (
                            <span className="text-[12px] font-normal text-[var(--accent)]">
                              当前会话
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[13px] text-[var(--faint)] vp-num">
                          <time
                            dateTime={new Date(session.createdAt).toISOString()}
                          >
                            {session.type === "cli" ? "授权" : "登录"}{" "}
                            {shortTime(session.createdAt)}
                          </time>
                          <span aria-hidden="true">·</span>
                          <time
                            dateTime={new Date(session.expiresAt).toISOString()}
                          >
                            到期 {shortTime(session.expiresAt)}
                          </time>
                        </div>
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="secondary"
                      compact
                      aria-label={`退出会话：${displayName}`}
                      disabled={!!busy || passwordBusy}
                      onClick={() => void revoke(session)}
                    >
                      退出
                    </Button>
                  </li>
                );
              })}
            </ul>
          </section>

          <DialogRoot
            open={passwordOpen}
            onOpenChange={(next) => {
              if (passwordBusy && !next) return;
              setPasswordOpen(next);
              if (!next) setPasswordError("");
            }}
          >
            <DialogContent
              id="account-password-dialog"
              title={settings.hasPassword ? "修改密码" : "设置密码"}
              dismissible={!passwordBusy}
            >
              <form
                id="change-password-form"
                method="post"
                className="space-y-4"
                onSubmit={savePassword}
                onChange={() => setPasswordError("")}
              >
                <input
                  hidden
                  readOnly
                  type="email"
                  id="change-username"
                  name="username"
                  autoComplete="username"
                  value={email}
                />
                {settings.hasPassword && (
                  <div>
                    <label
                      htmlFor="change-current-password"
                      className="mb-1.5 block text-[13px] font-medium text-[var(--text)]"
                    >
                      当前密码
                    </label>
                    <CredentialInput
                      ref={currentPasswordRef}
                      id="change-current-password"
                      type="password"
                      name="currentPassword"
                      autoComplete="current-password"
                      autoFocus
                      required
                    />
                  </div>
                )}
                <div>
                  <label
                    htmlFor="change-new-password"
                    className="mb-1.5 block text-[13px] font-medium text-[var(--text)]"
                  >
                    新密码
                  </label>
                  <CredentialInput
                    id="change-new-password"
                    name="newPassword"
                    type="password"
                    autoComplete="new-password"
                    minLength={8}
                    maxLength={128}
                    placeholder="8–128 个字符"
                    required
                  />
                </div>
                <div>
                  <label
                    htmlFor="change-confirm-password"
                    className="mb-1.5 block text-[13px] font-medium text-[var(--text)]"
                  >
                    确认新密码
                  </label>
                  <CredentialInput
                    id="change-confirm-password"
                    name="confirm"
                    type="password"
                    autoComplete="new-password"
                    required
                  />
                </div>
                <div>
                  <a
                    className="text-[12px] text-[var(--accent)] hover:underline"
                    href={`/login?mode=reset&next=${encodeURIComponent("/account")}`}
                  >
                    忘记当前密码？通过邮箱重置
                  </a>
                </div>
                {passwordError && (
                  <p className="text-[13px] text-[var(--negative)]" role="alert">
                    {passwordError}
                  </p>
                )}
                <div className="flex justify-end gap-2 pt-1">
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={passwordBusy}
                    onClick={() => setPasswordOpen(false)}
                  >
                    取消
                  </Button>
                  <Button
                    type="submit"
                    variant="primary"
                    disabled={passwordBusy}
                  >
                    保存密码
                  </Button>
                </div>
              </form>
            </DialogContent>
          </DialogRoot>
        </>
      )}

      {error && (
        <p role="alert" className="text-[13px] text-[var(--negative)]">
          {error}
        </p>
      )}
    </main>
  );
}
