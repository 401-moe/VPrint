import { type FormEvent, useRef, useState } from "react";
import { FileText, FolderOpen, Plus, Users } from "lucide-react";
import { Button } from "./components/ui/button";
import { DeleteGroup } from "./DeleteGroup";
import { api } from "./api";
import type { Team } from "./Shell";

export interface ContestSummary {
  id: string;
  name: string;
  createdAt: number;
  printCount: number;
  latestPrintId: string | null;
  latestFilename: string | null;
  latestPrintAt: number | null;
}
const timestamp = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai",
  year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
});
const time = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

export function ContestWorkspace({ team, contests, refresh, createTeam }: {
  team?: Team; contests: ContestSummary[]; refresh: () => void; createTeam: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const trigger = useRef<HTMLButtonElement>(null);
  function close() { setEditing(false); setName(""); setError(""); requestAnimationFrame(() => trigger.current?.focus()); }
  async function create(event: FormEvent) {
    event.preventDefault();
    if (!team || !name.trim() || busy) return;
    setBusy(true); setError("");
    try {
      await api(`/api/teams/${team.id}/contests`, { method: "POST", body: JSON.stringify({ name: name.trim() }) });
      close(); refresh();
    } catch { setError("创建比赛失败，请重试。"); }
    finally { setBusy(false); }
  }
  return <section className="teams-workspace">
    <header className="vp-heading"><div><h1>比赛工作台</h1>
      {team && <p>{contests.length} 场比赛 · {contests.reduce((sum, c) => sum + c.printCount, 0)} 份打印件</p>}</div>
      {team && <Button className="vp-primary" ref={trigger} aria-expanded={editing} disabled={busy}
        onClick={() => editing ? close() : setEditing(true)}><Plus size={15}/>新建比赛</Button>}
    </header>
    {team && editing && <form className="vp-form teams-contest-form" onSubmit={create}>
      <label className="vp-field">比赛名称<input autoFocus required maxLength={100} placeholder="周六训练" value={name} onChange={e => setName(e.target.value)} /></label>
      <Button type="submit" className="vp-primary" disabled={busy || !name.trim()}>创建比赛</Button>
      <Button type="button" variant="outline" className="vp-secondary" onClick={close} disabled={busy}>取消</Button>
      {error && <p className="vp-error" role="alert">{error}</p>}
    </form>}
    {team && contests.length > 0 ? <div className="teams-contests" data-owner={team.role === "owner"}>
      <div className="teams-column-titles" aria-hidden="true"><span>比赛名称</span><span>打印件</span><span>最近打印</span></div>
      <ul aria-label="比赛">{contests.map(contest => {
        const href = `/contest/${contest.id}`;
        return <li key={contest.id} className="teams-contest-row">
          <a className="teams-contest-link" href={href} aria-label={contest.name}>
            <span className="contest-folder"><FolderOpen size={19} aria-hidden="true"/></span>
            <span className="teams-contest-name"><strong>{contest.name}</strong><small>{timestamp.format(contest.createdAt)}</small></span>
          </a>
          <span className="teams-contest-count">{contest.printCount} 份</span>
          {contest.latestPrintId && contest.latestPrintAt !== null ? <a className="teams-contest-latest" href={href + "/print/" + contest.latestPrintId}
            aria-label={`阅读最近打印的 ${contest.latestFilename}，${time.format(contest.latestPrintAt)}`}>
            <FileText size={14} aria-hidden="true"/><span>{contest.latestFilename}</span><time>{time.format(contest.latestPrintAt)}</time>
          </a> : <span className="teams-contest-latest">尚未打印</span>}
          {team.role === "owner" && <DeleteGroup kind="contest" id={contest.id} name={contest.name} onDeleted={refresh}/>}
        </li>;
      })}</ul>
    </div> : <div className="vp-panel teams-empty">
      {team ? <><FolderOpen aria-hidden="true"/><p>还没有比赛。新建比赛后，就可以从 CLI 打印。</p></>
        : <><Users aria-hidden="true"/><p>你还没有加入队伍。可以创建队伍，或打开队长发来的邀请链接。</p>
          <Button className="vp-primary" onClick={createTeam}>新建队伍</Button></>}
    </div>}
  </section>;
}
