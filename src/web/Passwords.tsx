import { type FormEvent, useState, useRef } from "react";
import { Button } from "./components/ui/button";
import { api } from "./api";

const passwordMin = 8;
const passwordMax = 128;

function readNewPassword(fields: FormData) {
  const password = String(fields.get("password"));
  return password === fields.get("confirm") ? password : null;
}

export function PasswordReset({ initialEmail, firstPassword, signedIn, onReturn }: {
  initialEmail: string;
  firstPassword: boolean;
  signedIn: boolean;
  onReturn: (email: string, completed: boolean) => void;
}) {
  const codeInput = useRef<HTMLInputElement>(null);
  const [email, setEmail] = useState(initialEmail);
  const [challenge, setChallenge] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function requestCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await api("/api/auth/email-otp/request-password-reset", {
        method: "POST",
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      }, "验证码发送失败，请稍后重试。");
      const address = email.trim().toLowerCase();
      setChallenge(address);
      setEmail(address);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "验证码发送失败，请稍后重试。");
    } finally {
      setBusy(false);
    }
  }

  async function reset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!challenge || busy) return;
    const fields = new FormData(event.currentTarget);
    const password = readNewPassword(fields);
    if (!password) {
      setError("两次输入的新密码不一致。");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api("/api/auth/email-otp/reset-password", {
        method: "POST",
        body: JSON.stringify({ email: challenge, otp: fields.get("otp"), password }),
      }, "重置密码失败，请核对验证码后重试。");
      setDone(true);
    } catch (cause) {
      codeInput.current?.focus();
      setError(cause instanceof Error ? cause.message : "重置密码失败，请核对验证码后重试。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="password-recovery">
      <header className="vp-heading">
        <div>
          <h1>{done ? "密码已更新" : firstPassword ? "设置密码" : "重置密码"}</h1>
          <p>{done ? "为继续保护当前账号，请重新登录。" : "使用注册邮箱收到的验证码设置新密码。"}</p>
        </div>
      </header>
      <section className="vp-panel identity-panel">
        {done ? (
          <div className="vp-form" role="status">
            <p className="vp-note">{email} 的密码已更新，请使用新密码登录。</p>
            <Button className="vp-primary" onClick={() => onReturn(email, true)}>重新登录</Button>
          </div>
        ) : challenge ? (
          <form className="vp-form" onSubmit={reset} onChange={() => setError("")}>
            <div className="recovery-address">
              <span>{challenge}</span>
              {!signedIn && <button type="button" className="password-recovery-link" disabled={busy}
                onClick={() => { setChallenge(null); setError(""); }}>更换邮箱</button>}
            </div>
            <label className="vp-field" htmlFor="reset-otp">邮箱验证码
              <input ref={codeInput} id="reset-otp" name="otp" inputMode="numeric" autoComplete="one-time-code"
                pattern="[0-9]{6}" maxLength={6} autoFocus required />
            </label>
            <label className="vp-field" htmlFor="reset-password">新密码
              <input id="reset-password" name="password" type="password" autoComplete="new-password"
                minLength={passwordMin} maxLength={passwordMax} placeholder={`${passwordMin}–${passwordMax} 个字符`} required />
            </label>
            <label className="vp-field" htmlFor="reset-confirm">确认新密码
              <input id="reset-confirm" name="confirm" type="password" autoComplete="new-password" required />
            </label>
            {error && <p className="vp-error" role="alert">{error}</p>}
            <Button type="submit" className="vp-primary" disabled={busy}>{firstPassword ? "设置密码" : "重置密码"}</Button>
          </form>
        ) : (
          <form className="vp-form" onSubmit={requestCode} onChange={() => setError("")}>
            <label className="vp-field" htmlFor="reset-email">注册邮箱
              <input id="reset-email" type="email" autoComplete="email" value={email}
                onChange={event => setEmail(event.target.value)} readOnly={signedIn} required />
            </label>
            <p className="vp-meta">若这个邮箱已有 VPrint 账号，验证码将发送到该邮箱。</p>
            {error && <p className="vp-error" role="alert">{error}</p>}
            <Button type="submit" className="vp-primary" disabled={busy}>获取重置验证码</Button>
          </form>
        )}
        {!done && (
          <Button type="button" variant="ghost" className="vp-quiet identity-cancel" disabled={busy}
            onClick={() => onReturn(email, false)}>{signedIn ? "返回账号设置" : "返回登录"}</Button>
        )}
      </section>
    </div>
  );
}
