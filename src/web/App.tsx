import { FormEvent, useEffect, useState } from "react";
import "./App.css";
import { Workspace } from "./Workspace";

interface Member {
  id: string;
  email: string;
  name: string;
}

type Mode = "signin" | "signup";

const initialForm = { email: "", password: "", name: "" };

export function App() {
  const [member, setMember] = useState<Member | null>(null);
  const [memberChecked, setMemberChecked] = useState(false);
  const [form, setForm] = useState(initialForm);
  const [mode, setMode] = useState<Mode>("signup");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let active = true;

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
    setPending(true);
    setError(null);

    try {
      const response = await fetch(`/api/auth/sign-${mode === "signup" ? "up" : "in"}/email`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          mode === "signup" ? form : { email: form.email, password: form.password },
        ),
      });
      const body = (await response.json()) as { user?: Member; message?: string };

      if (!response.ok || !body.user) {
        setError(
          body.message ??
            (mode === "signup" ? "注册失败，请检查填写内容。" : "登录失败，请检查邮箱和密码。"),
        );
        return;
      }

      setForm(initialForm);
      setMember(body.user);
    } catch {
      setError("网络异常，请稍后重试。");
    } finally {
      setPending(false);
    }
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
                name="email"
                type="email"
                autoComplete="email"
                value={form.email}
                onChange={(event) => setForm({ ...form, email: event.target.value })}
                required
              />
            </label>
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
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <button className="button" type="submit" disabled={pending}>
              {pending ? "处理中…" : mode === "signup" ? "创建账号" : "登录"}
            </button>
          </form>
          <button
            className="button secondary"
            type="button"
            disabled={pending}
            onClick={() => {
              setMode(mode === "signup" ? "signin" : "signup");
              setError(null);
            }}
          >
            {mode === "signup" ? "已有账号？去登录" : "第一次使用？创建账号"}
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="shell">
      <Workspace member={member} error={error} pending={pending} signOut={signOut} />
    </main>
  );
}
