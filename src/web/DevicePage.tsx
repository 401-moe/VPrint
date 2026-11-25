import { type FormEvent, useLayoutEffect, useRef, useState } from "react";
import { Check, ChevronRight, X } from "lucide-react";
import { Button } from "./components/ui/button";

interface Device {
  userCode: string;
  hostname: string;
  os: string;
}

const osNames: Record<string, string> = { darwin: "macOS", linux: "Linux", win32: "Windows" };

export function DevicePage({ email }: { email: string }) {
  const [code, setCode] = useState(() => new URLSearchParams(location.search).get("user_code") ?? "");
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
      const response = await fetch("/api/cli/device?" + query, { cache: "no-store" });
      if (!response.ok) throw new Error(response.status === 401 ? "请刷新页面并重新登录。" : "短码无效或已过期，请核对终端显示的短码。");
      setDevice(await response.json() as Device);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "无法查询短码，请重试。");
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
        headers: { "content-type": "application/json", "x-vprint-device-decision": "1" },
        body: JSON.stringify({ userCode: device.userCode, approve, keepSignedIn: approve && remember }),
      });
      if (!response.ok) throw new Error(response.status === 401 ? "请刷新页面并重新登录。" : "授权未完成，请核对短码是否仍有效。");
      setResult(approve ? "approved" : "denied");
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "无法提交，请重试。");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="vp-device">
      <header className="vp-heading">
        <div>
          <h1 id="device-title" ref={heading} tabIndex={-1}>
            {result === "approved" ? "已批准主机登录" : result === "denied" ? "已拒绝主机登录" : "授权比赛主机"}
          </h1>
          <p>{result ? "可以回到运行 vprint login 的终端。" : device ? "请核对主机和账号，再决定是否授权。" : "输入比赛主机终端显示的短码。"}</p>
        </div>
      </header>
      <section className="vp-panel device-form" aria-labelledby="device-title">
        {result ? (
          <div className="device-result">
            {result === "approved" ? <Check aria-hidden="true" /> : <X aria-hidden="true" />}
            <strong>{device?.hostname}</strong>
            <p>{result === "approved" ? `CLI 会话有效期为 ${remember ? "30 天" : "8 小时"}。` : "此主机未获得访问权限。"}</p>
            <a className="vp-text-action" href={result === "approved" ? "/account" : "/"}>
              {result === "approved" ? "查看已登录会话" : "返回工作台"}
              <ChevronRight size={14} aria-hidden="true" />
            </a>
          </div>
        ) : device ? (
          <>
            <div className="vp-form">
              <dl className="confirm-facts">
                <dt>比赛主机</dt><dd><strong>{device.hostname}</strong> · {osNames[device.os] ?? device.os}</dd>
                <dt>终端短码</dt><dd><code>{device.userCode}</code></dd>
                <dt>VPrint 账号</dt><dd>{email}</dd>
                <dt>允许操作</dt><dd>选择队伍和比赛、提交打印件</dd>
            </dl>
              <label className="device-remember">
                <input type="checkbox" checked={remember} disabled={pending} onChange={event => setRemember(event.target.checked)} />
                在这台比赛主机上保持登录 30 天
              </label>
              <p className="vp-meta">这次授权有效期为 {remember ? "30 天" : "8 小时"}。</p>
              <div className="vp-actions">
                <Button className="vp-primary" disabled={pending} onClick={() => void decide(true)}>
                  {pending ? "提交中…" : "批准登录"}
                </Button>
                <Button type="button" variant="outline" className="vp-secondary" disabled={pending} onClick={() => void decide(false)}>
                  拒绝
                </Button>
              </div>
            </div>
          </>
        ) : (
          <form className="vp-form" onSubmit={lookup}>
            <label className="field">终端短码
              <input className="vp-code" name="userCode" placeholder="XXXX-XXXX" autoComplete="off" autoCapitalize="characters" spellCheck={false} value={code}
                onChange={event => { setCode(event.target.value); setError(""); }} aria-invalid={!!error} aria-describedby={error ? "device-code-error" : undefined}
                maxLength={32} autoFocus required />
            </label>
            {error && <p id="device-code-error" className="vp-error" role="alert">{error}</p>}
            <Button type="submit" className="vp-primary" disabled={pending || !code.trim()}>
              {pending ? "核对中…" : "核对短码"}
            </Button>
          </form>
        )}
      </section>
    </div>
  );
}
