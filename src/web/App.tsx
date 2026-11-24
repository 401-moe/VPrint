import { FormEvent, useEffect, useRef, useState } from "react";
import { AccountSettings } from "./AccountSettings";
import { DevicePage } from "./DevicePage";
import "./App.css";
import { GithubChoice, openGithub } from "./GithubChoice";
import { Workspace } from "./Workspace";

interface Member {
  id: string;
  email: string;
  name: string;
}

type Mode = "signin" | "signup" | "otp";

const githubPath = "/github/choice";
const githubBinding = location.pathname === githubPath && new URLSearchParams(location.search).has("bind");
const otpFallback = location.pathname === "/login" && new URLSearchParams(location.search).get("method") === "otp";

const initialForm = { email: "", password: "", name: "" };

export function App() {
  const [member, setMember] = useState<Member | null>(null);
  const [memberChecked, setMemberChecked] = useState(false);
  const [form, setForm] = useState(initialForm);
  const [mode, setMode] = useState<Mode>(githubBinding ? "signin" : otpFallback ? "otp" : "signup");
  const [otp, setOtp] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [returnTo, setReturnTo] = useState<string | null>(null);
  const emailInput = useRef<HTMLInputElement>(null);
  const [sentTo, setSentTo] = useState("");

  useEffect(() => {
    let active = true;

    const next = new URLSearchParams(window.location.search).get("next");
    const location = otpFallback && next?.startsWith("/") && !next.startsWith("//") ? next : window.location.pathname + window.location.search;
    if (location !== "/") setReturnTo(location);

    fetch("/api/me")
      .then((response) => (response.ok ? response.json() : null))
      .then((value) => {
        if (active) setMember(value as Member | null);
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setMemberChecked(true);
      });

    return () => {
      active = false;
    };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mode === "otp") {
      await signInWithOtp();
      return;
    }

    setPending(true);
    setError(null);

    try {
      const response = await fetch(
        mode === "signup" ? "/api/auth/sign-up/email" : "/api/auth/sign-in/email",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(
            mode === "signup" ? form : { email: form.email, password: form.password },
          ),
        },
      );
      const body = (await response.json()) as { user?: Member; message?: string };

      if (!response.ok || !body.user) {
        setError(
          body.message ??
            (mode === "signup" ? "注册失败，请检查填写内容。" : "登录失败，请检查邮箱和密码。"),
        );
        return;
      }

      restoreLocation();
      setForm(initialForm);
      setMember(body.user);
    } catch {
      setError("网络异常，请稍后重试。");
    } finally {
      setPending(false);
    }
  }

  const otpHeaders: Record<string, string> = { "content-type": "application/json" };
  if (githubBinding) otpHeaders["x-vprint-existing-account"] = "1";

  async function requestOtp() {
    if (!emailInput.current?.reportValidity()) return;
    setPending(true);
    setError(null);

    try {
      const response = await fetch("/api/auth/email-otp/send-verification-otp", {
        method: "POST",
        headers: otpHeaders,
        body: JSON.stringify({ email: form.email, type: "sign-in" }),
      });
      const body = (await response.json()) as { message?: string };

      if (!response.ok) {
        setError(body.message ?? "验证码发送失败，请稍后重试。");
        return;
      }
      setSentTo(form.email);
    } catch {
      setError("网络异常，请稍后重试。");
    } finally {
      setPending(false);
    }
  }

  function switchMode(nextMode: Mode) {
    setMode(nextMode);
    setError(null);
    if (nextMode === "otp") emailInput.current?.focus();
  }

  async function signInWithOtp() {
    setPending(true);
    setError(null);

    try {
      const response = await fetch("/api/auth/sign-in/email-otp", {
        method: "POST",
        headers: otpHeaders,
        body: JSON.stringify({ email: form.email, otp }),
      });
      const body = (await response.json()) as { user?: Member; message?: string };

      if (!response.ok || !body.user) {
        setError(body.message ?? "登录失败，请检查验证码。");
        return;
      }

      restoreLocation();
      setForm(initialForm);
      setOtp("");
      setMember(body.user);
    } catch {
      setError("网络异常，请稍后重试。");
    } finally {
      setPending(false);
    }
  }

  function restoreLocation() {
    if (!returnTo) return;

    const target = new URL(returnTo, window.location.origin);
    if (target.origin !== window.location.origin) return;

    window.history.replaceState(null, "", `${target.pathname}${target.search}`);
    setReturnTo(null);
  }

  async function signOut() {
    setPending(true);

    try {
      const response = await fetch("/api/auth/sign-out", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });

      if (!response.ok) {
        setError("退出失败，请稍后重试。");
        return;
      }

      setMember(null);
      setMode("signin");
      setReturnTo(`${window.location.pathname}${window.location.search}`);
      setError(null);
    } catch {
      setError("网络异常，请稍后重试。");
    } finally {
      setPending(false);
    }
  }

  if (!memberChecked) {
    return (
      <main className="shell" aria-busy="true">
        <section className="card">
          <h1 className="title">VPrint</h1>
          <p className="subtitle loading-subtitle">正在读取登录状态…</p>
        </section>
      </main>
    );
  }

  if (location.pathname === githubPath && (!githubBinding || member)) return <GithubChoice member={member} />;

  if (!member) {
    return (
      <main className="shell">
        <section className="card" aria-labelledby="auth-title">
          <h1 className="title" id="auth-title">
            VPrint
          </h1>
          <p className="subtitle">队员的队内电子打印工作台</p>
          <form className="fields" onSubmit={submit}>
            {mode === "signup" && (
              <label className="field">
                姓名
                <input
                  name="name"
                  autoComplete="name"
                  value={form.name}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                  required
                />
              </label>
            )}
            <label className="field">
              邮箱
              <input
                ref={emailInput}
                name="email"
                type="email"
                autoComplete="email"
                value={form.email}
                onChange={(event) => setForm({ ...form, email: event.target.value })}
                required
              />
            </label>
            {mode !== "otp" && (
              <label className="field">
                密码
                <input
                  name="password"
                  type="password"
                  autoComplete={mode === "signup" ? "new-password" : "current-password"}
                  minLength={8}
                  value={form.password}
                  onChange={(event) => setForm({ ...form, password: event.target.value })}
                  required
                />
              </label>
            )}
            {mode === "otp" && (
              <label className="field">
                验证码
                <input
                  name="otp"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="\d{6}"
                  maxLength={6}
                  value={otp}
                  onChange={(event) => setOtp(event.target.value)}
                  required
                />
              </label>
            )}
            {mode === "otp" && (
              <button
                className="button secondary"
                type="button"
                disabled={pending}
                onClick={() => void requestOtp()}
              >
                发送验证码
              </button>
            )}
            {mode === "otp" && sentTo === form.email && sentTo && <p role="status">验证码已发送至 {sentTo}</p>}
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <button className="button" type="submit" disabled={pending}>
              {pending
                ? "处理中…"
                : mode === "signup"
                  ? "创建账号"
                  : mode === "otp"
                    ? "验证并登录"
                    : "登录"}
            </button>
          </form>
          {!githubBinding && mode !== "signup" && <button className="button secondary" type="button" disabled={pending} onClick={() => switchMode("signup")}>第一次使用？创建账号</button>}
          <button
            className="button secondary"
            type="button"
            disabled={pending}
            onClick={() =>
              switchMode(mode === "signup" ? "signin" : mode === "signin" ? "otp" : "signin")
            }
          >
            {mode === "signup"
              ? "已有账号？去登录"
              : mode === "signin"
                ? "使用邮箱验证码"
                : "返回密码登录"}
          </button>
          {!githubBinding && <button className="button secondary" type="button" disabled={pending} onClick={async () => {
            setPending(true);
            try { await openGithub(returnTo ?? "/"); }
            catch (cause) { setError(cause instanceof Error ? cause.message : "GitHub 登录失败。"); setPending(false); }
          }}>使用 GitHub 登录</button>}
        </section>
      </main>
    );
  }

  if (location.pathname === "/account") return <AccountSettings email={member.email} />;
  if (location.pathname === "/device") return <DevicePage email={member.email} />;

  return (
    <main className="shell">
      <Workspace member={member} error={error} pending={pending} signOut={signOut} />
    </main>
  );
}
