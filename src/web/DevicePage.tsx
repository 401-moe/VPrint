import { type FormEvent, useState } from "react";

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

  async function lookup(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      const query = new URLSearchParams({ userCode: code.trim() });
      const response = await fetch("/api/cli/device?" + query, { cache: "no-store" });
      if (!response.ok) throw new Error(response.status === 401 ? "请刷新页面并重新登录。" : "短码无效或已过期，请核对终端显示的短码。");
      setDevice(await response.json() as Device);
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
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userCode: device.userCode, approve, keepSignedIn: approve && remember }),
      });
      if (!response.ok) throw new Error(response.status === 401 ? "请刷新页面并重新登录。" : "授权未完成，请核对短码是否仍有效。");
      setResult(approve ? "approved" : "denied");
    } catch (err) {
      setError(err instanceof Error ? err.message : "无法提交，请重试。");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="shell">
      <section className="card device-card" aria-labelledby="device-title">
        <h1 className="title" id="device-title">{result === "approved" ? "已批准主机登录" : result === "denied" ? "已拒绝主机登录" : "授权比赛主机"}</h1>
        {result ? (
          <p>可以回到运行 vprint login 的终端。</p>
        ) : device ? (
          <>
            <dl>
              <dt>比赛主机</dt><dd><strong>{device.hostname}</strong> · {osNames[device.os] ?? device.os}</dd>
              <dt>终端短码</dt><dd><code>{device.userCode}</code></dd>
              <dt>VPrint 账号</dt><dd>{email}</dd>
              <dt>授权范围</dt><dd>选择队伍和比赛、提交打印件</dd>
            </dl>
            <p>本次授权默认有效 8 小时。</p>
            <label><input type="checkbox" checked={remember} disabled={pending} onChange={event => setRemember(event.target.checked)} /> 在这台比赛主机上保持登录 30 天</label>
            <div className="actions">
              <button className="button" disabled={pending} onClick={() => decide(true)}>批准登录</button>
              <button className="button secondary" disabled={pending} onClick={() => decide(false)}>拒绝</button>
            </div>
          </>
        ) : (
          <form className="fields" onSubmit={lookup}>
            <label className="field">终端短码
              <input name="userCode" autoComplete="off" autoCapitalize="characters" spellCheck={false} value={code}
                onChange={event => setCode(event.target.value)} maxLength={32} required />
            </label>
            <button className="button" disabled={pending || !code.trim()}>核对短码</button>
          </form>
        )}
        {error && <p className="error" role="alert">{error}</p>}
      </section>
    </main>
  );
}
