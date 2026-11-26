import { type FormEvent, useRef, useState } from "react";
import { api } from "./api";
import { Button } from "./ui/button";
import { CredentialInput } from "./ui/input";

const passwordMin = 8;
const passwordMax = 128;

function readNewPassword(fields: FormData) {
  const password = String(fields.get("password"));
  return password === fields.get("confirm") ? password : null;
}

export function PasswordReset({
  initialEmail,
  firstPassword,
  signedIn,
  onReturn,
}: {
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
    const address = String(new FormData(event.currentTarget).get("email"))
      .trim()
      .toLowerCase();
    setBusy(true);
    setError("");
    try {
      await api(
        "/api/auth/email-otp/request-password-reset",
        {
          method: "POST",
          body: JSON.stringify({ email: address }),
        },
        "验证码发送失败，请稍后重试。",
      );
      setChallenge(address);
      setEmail(address);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "验证码发送失败，请稍后重试。",
      );
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
      await api(
        "/api/auth/email-otp/reset-password",
        {
          method: "POST",
          body: JSON.stringify({
            email: challenge,
            otp: fields.get("otp"),
            password,
          }),
        },
        "重置密码失败，请核对验证码后重试。",
      );
      setDone(true);
    } catch (cause) {
      codeInput.current?.focus();
      setError(
        cause instanceof Error ? cause.message : "重置密码失败，请核对验证码后重试。",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <header className="mb-5">
        <h1 className="vp-page-title">
          {done ? "密码已更新" : firstPassword ? "设置密码" : "重置密码"}
        </h1>
        <p className="mt-1 text-[13px] text-[var(--muted)]">
          {done
            ? "为继续保护当前账号，请重新登录。"
            : "使用注册邮箱收到的验证码设置新密码。"}
        </p>
      </header>

      <section className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] vp-form-padding">
        {done ? (
          <div className="space-y-4" role="status">
            <p className="text-[13px] text-[var(--text)]">
              {email} 的密码已更新，请使用新密码登录。
            </p>
            <Button
              variant="primary"
              className="h-9 w-full"
              onClick={() => onReturn(email, true)}
            >
              重新登录
            </Button>
          </div>
        ) : challenge ? (
          <form
            key="reset"
            id="reset-password-form"
            method="post"
            className="space-y-4"
            onSubmit={reset}
            onChange={() => setError("")}
          >
            <input
              hidden
              readOnly
              type="email"
              id="reset-username"
              name="username"
              autoComplete="username"
              value={challenge}
            />
            <div className="flex items-center justify-between gap-2 rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--ground)] px-3 py-2 text-[13px]">
              <span className="truncate font-medium text-[var(--text)]">
                {challenge}
              </span>
              {!signedIn && (
                <button
                  type="button"
                  className="shrink-0 text-[12px] text-[var(--accent)] hover:underline cursor-pointer"
                  disabled={busy}
                  onClick={() => {
                    setChallenge(null);
                    setError("");
                  }}
                >
                  更换邮箱
                </button>
              )}
            </div>

            <div>
              <label
                htmlFor="reset-otp"
                className="mb-1.5 block text-[13px] font-medium text-[var(--text)]"
              >
                邮箱验证码
              </label>
              <CredentialInput
                ref={codeInput}
                id="reset-otp"
                name="otp"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                autoFocus
                required
                className="vp-num"
              />
            </div>

            <div>
              <label
                htmlFor="reset-password"
                className="mb-1.5 block text-[13px] font-medium text-[var(--text)]"
              >
                新密码
              </label>
              <CredentialInput
                id="reset-password"
                name="password"
                type="password"
                autoComplete="new-password"
                minLength={passwordMin}
                maxLength={passwordMax}
                placeholder={`${passwordMin}–${passwordMax} 个字符`}
                required
              />
            </div>

            <div>
              <label
                htmlFor="reset-confirm"
                className="mb-1.5 block text-[13px] font-medium text-[var(--text)]"
              >
                确认新密码
              </label>
              <CredentialInput
                id="reset-confirm"
                name="confirm"
                type="password"
                autoComplete="new-password"
                required
              />
            </div>

            {error && (
              <p
                className="rounded-[var(--radius-control)] border border-[var(--negative)]/30 bg-[var(--negative)]/5 px-3 py-2 text-[13px] text-[var(--negative)]"
                role="alert"
              >
                {error}
              </p>
            )}

            <Button
              type="submit"
              variant="primary"
              className="h-9 w-full"
              disabled={busy}
            >
              {firstPassword ? "设置密码" : "重置密码"}
            </Button>
          </form>
        ) : (
          <form
            key="request"
            id="request-reset-form"
            method="post"
            className="space-y-4"
            onSubmit={requestCode}
            onChange={() => setError("")}
          >
            <div>
              <label
                htmlFor="reset-email"
                className="mb-1.5 block text-[13px] font-medium text-[var(--text)]"
              >
                注册邮箱
              </label>
              <CredentialInput
                id="reset-email"
                name="email"
                type="email"
                autoComplete="username"
                spellCheck={false}
                defaultValue={email}
                onChange={(event) => setEmail(event.target.value)}
                readOnly={signedIn}
                required
              />
            </div>
            <p className="text-[12px] text-[var(--muted)]">
              若这个邮箱已有 VPrint 账号，验证码将发送到该邮箱。
            </p>
            {error && (
              <p
                className="rounded-[var(--radius-control)] border border-[var(--negative)]/30 bg-[var(--negative)]/5 px-3 py-2 text-[13px] text-[var(--negative)]"
                role="alert"
              >
                {error}
              </p>
            )}
            <Button
              type="submit"
              variant="primary"
              className="h-9 w-full"
              disabled={busy}
            >
              获取重置验证码
            </Button>
          </form>
        )}

        {!done && (
          <Button
            type="button"
            variant="ghost"
            className="mt-3 h-9 w-full"
            disabled={busy}
            onClick={() => onReturn(email, false)}
          >
            {signedIn ? "返回账号设置" : "返回登录"}
          </Button>
        )}
      </section>
    </div>
  );
}
