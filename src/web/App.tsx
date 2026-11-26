import { FormEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Github, KeyRound } from "lucide-react";
import { DevicePage } from "./DevicePage";
import { GithubChoice, openGithub } from "./GithubChoice";
import { PasswordReset } from "./Passwords";
import { BreadcrumbHeader } from "./Shell";
import { Button } from "./ui/button";
import { CredentialInput } from "./ui/input";
import { Workspace } from "./Workspace";
import { api, ApiError } from "./api";

interface Member {
  id: string;
  email: string;
  name: string;
}

type Mode = "signin" | "signup" | "otp";

const authActions = {
  signin: { path: "/api/auth/sign-in/email", error: "登录失败，请检查邮箱和密码。" },
  signup: { path: "/api/auth/sign-up/email", error: "注册失败，请检查填写内容。" },
  otp: { path: "/api/auth/sign-in/email-otp", error: "登录失败，请检查验证码。" },
};

const githubPath = "/github/choice";
const githubBinding =
  location.pathname === githubPath &&
  new URLSearchParams(location.search).has("bind");
const otpFallback =
  location.pathname === "/login" &&
  new URLSearchParams(location.search).get("method") === "otp";

function loginDestination() {
  if (location.pathname !== "/login") return location.pathname + location.search;
  const next = new URLSearchParams(location.search).get("next");
  if (!next?.startsWith("/") || next.startsWith("//")) return "/workspace";
  let target: URL;
  try {
    target = new URL(next, location.origin);
  } catch {
    return "/workspace";
  }
  return target.origin === location.origin && !["/", "/login"].includes(target.pathname)
    ? target.pathname + target.search
    : "/workspace";
}

function SignupPassword() {
  const [visible, setVisible] = useState(false);
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <label
          htmlFor="signup-new-password"
          className="text-[13px] font-medium text-[var(--text)]"
        >
          设置密码
        </label>
        <button
          type="button"
          className="text-[12px] text-[var(--accent)] hover:underline cursor-pointer"
          aria-pressed={visible}
          aria-controls="signup-new-password"
          onClick={() => setVisible(!visible)}
        >
          显示密码
        </button>
      </div>
      <CredentialInput
        id="signup-new-password"
        name="password"
        type={visible ? "text" : "password"}
        autoComplete="new-password"
        minLength={8}
        maxLength={128}
        required
        aria-describedby="signup-password-hint"
      />
      <span
        id="signup-password-hint"
        className="mt-1 block text-[12px] text-[var(--faint)]"
      >
        8–128 个字符
      </span>
    </div>
  );
}

export function App() {
  const [member, setMember] = useState<Member | null>(null);
  const [sessionState, setSessionState] = useState<"loading" | "ready" | "failed">(
    "loading",
  );
  const [email, setEmail] = useState("");
  const [signupName, setSignupName] = useState("");
  const [mode, setMode] = useState<Mode>(otpFallback ? "otp" : "signin");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [returnTo, setReturnTo] = useState<string>(loginDestination);
  const emailInput = useRef<HTMLInputElement>(null);
  const passwordInput = useRef<HTMLInputElement>(null);
  const focusAfterSwitch = useRef(false);
  const otpInput = useRef<HTMLInputElement>(null);
  const [sentTo, setSentTo] = useState("");
  const [showPasswordReset, setShowPasswordReset] = useState(
    location.pathname === "/login" &&
      new URLSearchParams(location.search).get("mode") === "reset",
  );

  useEffect(() => {
    const controller = new AbortController();
    api<Member>("/api/me", { signal: controller.signal })
      .then((value) => {
        if (controller.signal.aborted) return;
        if (
          value &&
          location.pathname === "/login" &&
          new URLSearchParams(location.search).get("mode") !== "reset"
        ) {
          history.replaceState(null, "", loginDestination());
        }
        setMember(value);
        setSessionState("ready");
      })
      .catch((cause) => {
        if (!controller.signal.aborted) {
          setSessionState(
            cause instanceof ApiError && cause.status === 401 ? "ready" : "failed",
          );
        }
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const syncPath = () => {
      const reset =
        location.pathname === "/login" &&
        new URLSearchParams(location.search).get("mode") === "reset";
      setShowPasswordReset(reset);
    };
    window.addEventListener("popstate", syncPath);
    return () => window.removeEventListener("popstate", syncPath);
  }, []);

  useLayoutEffect(() => {
    if (!focusAfterSwitch.current) return;
    focusAfterSwitch.current = false;
    if (mode === "signup") document.getElementById("signup-name")?.focus();
    else if (mode === "signin" && emailInput.current?.value)
      passwordInput.current?.focus();
    else emailInput.current?.focus();
  }, [mode, showPasswordReset]);

  const otpHeaders: Record<string, string> = {};
  if (githubBinding) otpHeaders["x-vprint-existing-account"] = "1";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = event.currentTarget;
    const fields = new FormData(form);
    const emailField = fields.get("email");
    const credentials =
      mode === "otp"
        ? { email: emailField, otp: fields.get("otp") }
        : { email: emailField, password: fields.get("password") };
    const body =
      mode === "signup"
        ? { ...credentials, name: fields.get("name") }
        : credentials;
    setPending(true);
    setError(null);
    try {
      const result = await api<{ user: Member }>(
        authActions[mode].path,
        {
          method: "POST",
          headers: mode === "otp" ? otpHeaders : undefined,
          body: JSON.stringify(body),
        },
        authActions[mode].error,
      );
      restoreLocation();
      setEmail("");
      setSignupName("");
      setSentTo("");
      setMember(result.user);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "网络异常，请稍后重试。");
      const retryField = form.elements.namedItem(
        mode === "otp" ? "otp" : "password",
      );
      if (retryField instanceof HTMLInputElement) retryField.focus();
    } finally {
      setPending(false);
    }
  }

  async function requestOtp() {
    if (!emailInput.current?.reportValidity()) return;
    const address = emailInput.current.value;
    setEmail(address);
    setPending(true);
    setError(null);

    try {
      await api(
        "/api/auth/email-otp/send-verification-otp",
        {
          method: "POST",
          headers: otpHeaders,
          body: JSON.stringify({ email: address, type: "sign-in" }),
        },
        "验证码发送失败，请稍后重试。",
      );
      setSentTo(address);
      otpInput.current?.focus();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "网络异常，请稍后重试。");
    } finally {
      setPending(false);
    }
  }

  function switchMode(nextMode: Mode) {
    if (mode === nextMode || (githubBinding && nextMode === "signup")) return;
    setEmail(emailInput.current?.value ?? "");
    focusAfterSwitch.current = true;
    setMode(nextMode);
    setError(null);
  }

  function restoreLocation() {
    if (!returnTo) return;
    const target = new URL(returnTo, window.location.origin);
    if (target.origin !== window.location.origin) return;
    window.history.replaceState(null, "", `${target.pathname}${target.search}`);
    setReturnTo("/workspace");
  }

  async function signOut() {
    setPending(true);
    try {
      await api(
        "/api/auth/sign-out",
        { method: "POST", body: "{}" },
        "退出失败，请稍后重试。",
      );
      setMember(null);
      setMode("signin");
      setReturnTo(`${window.location.pathname}${window.location.search}`);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "网络异常，请稍后重试。");
    } finally {
      setPending(false);
    }
  }

  if (sessionState === "loading") return <BreadcrumbHeader />;

  if (sessionState === "failed") {
    return (
      <>
        <BreadcrumbHeader />
        <main className="mx-auto max-w-[460px] px-4 py-12">
          <section className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-6">
            <h1 className="text-[20px] font-semibold tracking-[-0.02em] text-[var(--text)]">
              无法读取登录状态
            </h1>
            <p className="mt-2 text-[13px] text-[var(--muted)]">
              请检查网络后重试。
            </p>
            <Button
              variant="secondary"
              className="mt-4"
              onClick={() => location.reload()}
            >
              重新加载
            </Button>
          </section>
        </main>
      </>
    );
  }

  if (location.pathname === githubPath && (!githubBinding || member)) {
    return <GithubChoice member={member} />;
  }

  if (showPasswordReset) {
    const firstPassword =
      new URLSearchParams(location.search).get("first") === "1";
    return (
      <>
        <BreadcrumbHeader memberName={member?.name} />
        <main className="mx-auto max-w-[460px] px-4 py-10">
          <PasswordReset
            initialEmail={member?.email || email}
            firstPassword={firstPassword && !!member}
            signedIn={!!member}
            onReturn={(nextEmail, completed) => {
              if (member && !completed) {
                location.replace("/account");
                return;
              }
              setEmail(nextEmail);
              setMember(null);
              setMode("signin");
              setError(null);
              setShowPasswordReset(false);
              history.replaceState(
                null,
                "",
                "/login?next=" + encodeURIComponent(returnTo),
              );
              focusAfterSwitch.current = true;
            }}
          />
        </main>
      </>
    );
  }

  if (!member) {
    return (
      <>
        <BreadcrumbHeader />
        <main className="mx-auto max-w-[440px] px-4 py-10">
          <header className="mb-5">
            <h1 className="vp-page-title">
              {mode === "signup" ? "创建 VPrint 账号" : "登录训练工作区"}
            </h1>
            <p className="mt-1 text-[13px] text-[var(--muted)]">
              {githubBinding
                ? "验证已有账号后绑定这个 GitHub 身份。"
                : "登录后可查看本队比赛和打印件。"}
            </p>
          </header>

          <section
            className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] vp-form-padding"
            aria-labelledby="login-panel-title"
          >
            <div
              className="mb-5 grid gap-1 rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--ground)] p-1"
              style={{
                gridTemplateColumns: githubBinding
                  ? "repeat(2, minmax(0, 1fr))"
                  : "repeat(3, minmax(0, 1fr))",
              }}
              role="group"
              aria-label="登录方式"
            >
              {(githubBinding
                ? (["signin", "otp"] as const)
                : (["signin", "otp", "signup"] as const)
              ).map((nextMode) => {
                const active = mode === nextMode;
                return (
                  <Button
                    key={nextMode}
                    type="button"
                    variant="ghost"
                    compact
                    disabled={pending}
                    aria-pressed={active}
                    onClick={() => switchMode(nextMode)}
                    className={
                      active
                        ? "bg-[var(--surface)] text-[var(--text)] border border-[var(--border)] font-medium"
                        : "text-[var(--muted)]"
                    }
                  >
                    {nextMode === "signin"
                      ? "密码登录"
                      : nextMode === "otp"
                        ? "验证码登录"
                        : "注册"}
                  </Button>
                );
              })}
            </div>

            <h2 className="sr-only" id="login-panel-title">
              {mode === "signup"
                ? "创建账号"
                : mode === "otp"
                  ? "邮箱验证码登录"
                  : "密码登录"}
            </h2>

            <form
              key={mode}
              id={`${mode}-form`}
              method="post"
              action={authActions[mode].path}
              aria-labelledby="login-panel-title"
              className="space-y-4"
              onSubmit={submit}
              onChange={() => setError(null)}
            >
              {mode === "signup" && (
                <div>
                  <label
                    htmlFor="signup-name"
                    className="mb-1.5 block text-[13px] font-medium text-[var(--text)]"
                  >
                    姓名
                  </label>
                  <CredentialInput
                    id="signup-name"
                    name="name"
                    autoComplete="name"
                    pattern={String.raw`.*\S.*`}
                    title="姓名不能全为空白"
                    defaultValue={signupName}
                    onChange={(event) => setSignupName(event.target.value)}
                    required
                  />
                </div>
              )}

              <div>
                <label
                  htmlFor={`${mode}-email`}
                  className="mb-1.5 block text-[13px] font-medium text-[var(--text)]"
                >
                  邮箱
                </label>
                <CredentialInput
                  id={`${mode}-email`}
                  ref={emailInput}
                  name="email"
                  type="email"
                  autoComplete="username"
                  spellCheck={false}
                  defaultValue={email}
                  onChange={(event) => {
                    setEmail(event.target.value);
                    setSentTo("");
                  }}
                  required
                />
              </div>

              {mode === "signup" && <SignupPassword />}

              {mode === "signin" && (
                <div>
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <label
                      htmlFor="signin-password"
                      className="text-[13px] font-medium text-[var(--text)]"
                    >
                      密码
                    </label>
                    {!githubBinding && (
                      <a
                        className="text-[12px] text-[var(--accent)] hover:underline"
                        href={`/login?mode=reset&next=${encodeURIComponent(returnTo)}`}
                        onClick={(event) => {
                          if (
                            event.metaKey ||
                            event.ctrlKey ||
                            event.shiftKey ||
                            event.altKey
                          )
                            return;
                          event.preventDefault();
                          history.pushState(null, "", event.currentTarget.href);
                          setEmail(emailInput.current?.value ?? "");
                          setShowPasswordReset(true);
                        }}
                      >
                        忘记密码？
                      </a>
                    )}
                  </div>
                  <CredentialInput
                    id="signin-password"
                    name="password"
                    type="password"
                    ref={passwordInput}
                    autoComplete="current-password"
                    required
                  />
                </div>
              )}

              {mode === "otp" && (
                <div>
                  <label
                    htmlFor="login-otp"
                    className="mb-1.5 block text-[13px] font-medium text-[var(--text)]"
                  >
                    邮箱验证码
                  </label>
                  <div className="flex items-center gap-2">
                    <CredentialInput
                      ref={otpInput}
                      id="login-otp"
                      name="otp"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      pattern="[0-9]{6}"
                      maxLength={6}
                      required
                      className="flex-1 vp-num"
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={pending}
                      className="h-9 shrink-0"
                      onClick={() => void requestOtp()}
                    >
                      {sentTo === email && sentTo ? "重新发送" : "获取验证码"}
                    </Button>
                  </div>
                  {sentTo === email && sentTo && (
                    <p
                      className="mt-1.5 text-[12px] text-[var(--muted)]"
                      role="status"
                    >
                      验证码已发送至 {sentTo}
                    </p>
                  )}
                </div>
              )}

              {error && (
                <p
                  className="rounded-[var(--radius-control)] border border-[var(--negative)]/30 bg-[var(--negative)]/5 px-3 py-2 text-[13px] text-[var(--negative)]"
                  role="alert"
                >
                  {error}
                </p>
              )}

              <div className="space-y-2.5 pt-1">
                <Button
                  type="submit"
                  variant="primary"
                  disabled={pending}
                  className="h-9 w-full"
                >
                  <KeyRound size={15} aria-hidden="true" />
                  <span>
                    {pending
                      ? "处理中…"
                      : mode === "signup"
                        ? "创建并进入"
                        : mode === "otp"
                          ? "验证并登录"
                          : "登录"}
                  </span>
                </Button>

                {!githubBinding && (
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={pending}
                    className="h-9 w-full"
                    onClick={async () => {
                      setPending(true);
                      try {
                        await openGithub(returnTo);
                      } catch (cause) {
                        setError(
                          cause instanceof Error
                            ? cause.message
                            : "GitHub 登录失败。",
                        );
                        setPending(false);
                      }
                    }}
                  >
                    <Github size={15} aria-hidden="true" />
                    <span>使用 GitHub 登录</span>
                  </Button>
                )}
              </div>
            </form>

            {githubBinding && (
              <Button
                type="button"
                variant="secondary"
                className="mt-3 h-9 w-full"
                onClick={() => location.replace("/github/choice")}
              >
                返回 GitHub 选择
              </Button>
            )}
          </section>
        </main>
      </>
    );
  }

  if (location.pathname === "/device") {
    return (
      <>
        <BreadcrumbHeader memberName={member.name} />
        <main className="mx-auto max-w-[520px] px-4 py-10">
          <DevicePage email={member.email} />
        </main>
      </>
    );
  }

  return (
    <Workspace member={member} error={error} pending={pending} signOut={signOut} />
  );
}
