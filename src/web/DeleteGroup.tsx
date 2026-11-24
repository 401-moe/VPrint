import { useRef, useState } from "react";

type Summary = { name: string; contestCount?: number; printoutCount: number };

export function DeleteGroup({ kind, id, onDeleted }: {
  kind: "team" | "contest";
  id: string;
  onDeleted: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const target = kind === "team" ? "解散队伍" : "删除比赛";
  const endpoint = `/api/${kind === "team" ? "teams" : "contests"}/${id}/deletion`;

  async function preview() {
    setPending(true);
    setError("");
    try {
      const response = await fetch(endpoint);
      if (!response.ok) throw new Error();
      setSummary(await response.json() as Summary);
      dialog.current?.showModal();
    } catch { setError("无法读取删除范围。"); }
    finally { setPending(false); }
  }

  async function confirm() {
    setPending(true);
    setError("");
    try {
      const response = await fetch(endpoint, { method: "DELETE" });
      if (!response.ok) throw new Error();
      dialog.current?.close();
      onDeleted();
    } catch { setError("操作失败，请重新确认权限。"); }
    finally { setPending(false); }
  }

  return (
    <div>
      <button className="button secondary" type="button" onClick={preview} disabled={pending}>{target}</button>
      {error && !dialog.current?.open && <p role="alert">{error}</p>}
      <dialog ref={dialog} aria-label={target}>
        {summary && <>
          <h2>{target}「{summary.name}」</h2>
          <p>{kind === "team" && `${summary.contestCount} 场比赛、`}{summary.printoutCount} 份打印件将永久删除。</p>
          {error && <p role="alert">{error}</p>}
          <button type="button" className="button secondary" onClick={() => dialog.current?.close()} disabled={pending}>取消</button>
          <button type="button" className="button" onClick={confirm} disabled={pending}>确认{target}</button>
        </>}
      </dialog>
    </div>
  );
}
