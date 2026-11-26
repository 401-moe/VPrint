import { type FormEvent, useLayoutEffect, useRef, useState } from "react";
import { Check, ChevronRight, X } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

interface Device {
  userCode: string;
  hostname: string;
  os: string;
}

const osNames: Record<string, string> = {
  darwin: "macOS",
  linux: "Linux",
  win32: "Windows",
};

export function DevicePage({ email }: { email: string }) {
  const [code, setCode] = useState(
    () => new URLSearchParams(location.search).get("user_code") ?? "",
  );
  const [device, setDevice] = useState<Device | null>(null);
  const [result, setResult] = useState<"approved" | "denied" | null>(null);
  const [remember, setRemember] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  const phase = result ?? (device ? "check" : "code");
  const previousPhase = useRef(phase);

  useLayoutEffect(() => {
    if (previousPhase.current !== phase) heading.current?.focus();
    previousPhase.current = phase;
  }, [phase]);

  async function lookup(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      const query = new URLSearchParams({ userCode: code.trim() });
      const response = await fetch("/api/cli/device?" + query, {
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(
          response.status === 401
            ? "请刷新页面并重新登录。"
            : "短码无效或已过期，请核对终端显示的短码。",
        );
      }
      setDevice((await response.json()) as Device);
      setError("");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "无法查询短码，请重试。",
      );
    } finally {
      setPending(false);
    }
  }

  async function decide(approve: boolean) {
    if (!device) return;
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/cli/device/decision", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-vprint-device-decision": "1",
        },
        body: JSON.stringify({
          userCode: device.userCode,
          approve,
          keepSignedIn: approve && remember,
        }),
      });
      if (!response.ok) {
        throw new Error(
          response.status === 401
            ? "请刷新页面并重新登录。"
            : "授权未完成，请核对短码是否仍有效。",
        );
      }
      setResult(approve ? "approved" : "denied");
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "无法提交，请重试。");
    } finally {
      setPending(false);
    }
  }

  return (
    <div>
      <header className="mb-5">
        <h1
          id="device-title"
          ref={heading}
          tabIndex={-1}
          className="text-[22px] sm:text-[24px] font-semibold tracking-[-0.02em] leading-[1.25] text-[var(--text)] outline-none"
        >
          {result === "approved"
            ? "已批准主机登录"
            : result === "denied"
              ? "已拒绝主机登录"
              : "授权比赛主机"}
        </h1>
        <p className="mt-1 text-[13px] text-[var(--muted)]">
          {result
            ? "可以回到运行 vprint login 的终端。"
            : device
              ? "请核对主机和账号，再决定是否授权。"
              : "输入比赛主机终端显示的短码。"}
        </p>
      </header>

      <section
        className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-5 sm:p-6"
        aria-labelledby="device-title"
      >
        {result ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2.5 text-[15px] font-semibold text-[var(--text)]">
              {result === "approved" ? (
                <Check size={18} className="text-[var(--accent)]" aria-hidden="true" />
              ) : (
                <X size={18} className="text-[var(--negative)]" aria-hidden="true" />
              )}
              <strong>{device?.hostname}</strong>
            </div>
            <p className="text-[13px] text-[var(--muted)]">
              {result === "approved"
                ? `CLI 会话有效期为 ${remember ? "30 天" : "8 小时"}。`
                : "此主机未获得访问权限。"}
            </p>
            <a
              className="inline-flex items-center gap-1 text-[13px] font-medium text-[var(--accent)] hover:underline"
              href={result === "approved" ? "/account" : "/workspace"}
            >
              <span>{result === "approved" ? "查看已登录会话" : "返回所有队伍"}</span>
              <ChevronRight size={14} aria-hidden="true" />
            </a>
          </div>
        ) : device ? (
          <div className="space-y-4">
            <dl className="divide-y divide-[var(--rule)] rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--ground)] px-3.5 text-[13px]">
              <div className="flex items-center justify-between gap-4 py-2.5">
                <dt className="text-[var(--muted)]">比赛主机</dt>
                <dd className="text-[var(--text)]">
                  <strong>{device.hostname}</strong> ·{" "}
                  {osNames[device.os] ?? device.os}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-4 py-2.5">
                <dt className="text-[var(--muted)]">终端短码</dt>
                <dd>
                  <code className="text-[13px] font-medium text-[var(--text)]">
                    {device.userCode}
                  </code>
                </dd>
              </div>
              <div className="flex items-center justify-between gap-4 py-2.5">
                <dt className="text-[var(--muted)]">VPrint 账号</dt>
                <dd className="text-[var(--text)]">{email}</dd>
              </div>
              <div className="flex items-center justify-between gap-4 py-2.5">
                <dt className="text-[var(--muted)]">允许操作</dt>
                <dd className="text-[var(--text)]">选择队伍和比赛、提交打印件</dd>
              </div>
            </dl>

            <label className="flex items-center gap-2.5 text-[13px] text-[var(--text)] cursor-pointer select-none max-md:min-h-[44px]">
              <input
                type="checkbox"
                checked={remember}
                disabled={pending}
                onChange={(event) => setRemember(event.target.checked)}
                className="size-4 accent-[var(--primary)]"
              />
              <span>在这台比赛主机上保持登录 30 天</span>
            </label>
            <p className="text-[12px] text-[var(--muted)]">
              这次授权有效期为 {remember ? "30 天" : "8 小时"}。
            </p>

            {error && (
              <p className="text-[13px] text-[var(--negative)]" role="alert">
                {error}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-2.5 pt-1">
              <Button
                variant="primary"
                disabled={pending}
                onClick={() => void decide(true)}
              >
                {pending ? "提交中…" : "批准登录"}
              </Button>
              <Button
                variant="secondary"
                disabled={pending}
                onClick={() => void decide(false)}
              >
                拒绝
              </Button>
            </div>
          </div>
        ) : (
          <form className="space-y-4" onSubmit={lookup}>
            <div>
              <label
                htmlFor="device-user-code"
                className="mb-1.5 block text-[13px] font-medium text-[var(--text)]"
              >
                终端短码
              </label>
              <Input
                id="device-user-code"
                className="vp-code-name uppercase tracking-[0.04em]"
                name="userCode"
                placeholder="XXXX-XXXX"
                autoCapitalize="characters"
                value={code}
                onChange={(event) => {
                  setCode(event.target.value);
                  setError("");
                }}
                aria-invalid={!!error}
                aria-describedby={error ? "device-code-error" : undefined}
                maxLength={32}
                autoFocus
                required
              />
            </div>

            {error && (
              <p
                id="device-code-error"
                className="text-[13px] text-[var(--negative)]"
                role="alert"
              >
                {error}
              </p>
            )}

            <Button
              type="submit"
              variant="primary"
              className="h-9 w-full"
              disabled={pending || !code.trim()}
            >
              {pending ? "核对中…" : "核对短码"}
            </Button>
          </form>
        )}
      </section>
    </div>
  );
}
