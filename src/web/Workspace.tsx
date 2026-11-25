import { type MouseEvent, useCallback, useEffect, useRef, useState } from "react";
import { LogOut } from "lucide-react";
import { api, ApiError } from "./api";
import { TeamManagement } from "./TeamManagement";
import { AccountSettings } from "./AccountSettings";
import { InvitePage } from "./InvitePage";
import { ContestWorkspace, type ContestSummary } from "./ContestWorkspace";
import { PrintList, PrintPage } from "./ContestPrints";
import { Header, CreateTeamDialog, TeamSwitcher, Sidebar, type Team } from "./Shell";
import { usePrintNotifications } from "./use-print-notifications";

interface WorkspaceData {
  teams: Team[];
  selectedTeamId: string | null;
  contests: ContestSummary[];
  contest: { id: string; name: string; createdAt: number; teamId: string } | null;
}
type Member = { id: string; name: string; email: string };

export function Workspace({ member, pending, error, signOut }: {
  member: Member; pending: boolean; error: string | null; signOut: () => void;
}) {
  const [path, setPath] = useState(location.pathname);
  const match = /^\/contest\/([^/]+)(?:\/print\/([^/]+))?$/.exec(path);
  const contestId = match?.[1] ?? "";
  const printId = match?.[2] ?? "";
  const invite = /^\/invite\/([^/]+)$/.exec(path);
  const isInvite = Boolean(invite);
  const teamPage = path === "/team";
  const account = path === "/account";
  const scoped = !account && !isInvite;
  const [snapshot, setSnapshot] = useState<{ key: string; data: WorkspaceData }>();
  const data = snapshot?.key === contestId ? snapshot.data : undefined;
  const team = data?.teams.find(t => t.id === data.selectedTeamId);
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision(v => v + 1), []);
  const [failed, setFailed] = useState<{ key: string; denied: boolean } | null>(null);
  const [actionError, setActionError] = useState("");
  const [switching, setSwitching] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const [listVersion, setListVersion] = useState(0);
  const [noticeId, setNoticeId] = useState("");
  const returnState = useRef<{ contestId: string; printId: string; scrollY: number } | null>(null);
  usePrintNotifications(data?.contest?.id ?? "", !!printId, notice => {
    if (notice.type === "reload") setListVersion(v => v + 1);
    if (notice.type === "toast" && notice.id) setNoticeId(notice.id);
  });

  useEffect(() => {
    if (!scoped) return;
    const controller = new AbortController();
    setFailed(null);
    api<WorkspaceData>("/api/workspace" + (contestId ? "?contestId=" + encodeURIComponent(contestId) : ""), { signal: controller.signal })
      .then(value => { if (!controller.signal.aborted) setSnapshot({ key: contestId, data: value }); })
      .catch(cause => {
        if (controller.signal.aborted) return;
        setSnapshot(undefined);
        setFailed({ key: contestId, denied: cause instanceof ApiError && [403, 404].includes(cause.status) });
      });
    return () => controller.abort();
  }, [contestId, scoped, revision]);
  useEffect(() => {
    const restore = () => { setPath(location.pathname); setNoticeId(""); setActionError(""); };
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, []);
  useEffect(() => {
    document.title = (account ? "账号设置" : teamPage ? "队伍设置" : isInvite ? "队伍邀请" : data?.contest?.name || team?.name || "比赛工作台") + " · VPrint";
  }, [account, teamPage, isInvite, data?.contest?.name, team?.name]);

  function navigate(to: string) {
    if (location.pathname !== to) history.pushState(null, "", to);
    setPath(to); setActionError(""); setNoticeId("");
    if (!to.match(/^\/contest\/[\w-]+$/)) window.scrollTo(0, 0);
  }
  async function persistSelection(id: string) {
    await api(`/api/teams/${id}/selection`, { method: "PUT", body: "{}" });
    if (id !== team?.id) setSnapshot(undefined);
    refresh();
  }
  async function select(id: string, destination?: string) {
    if (switching) return;
    setSwitching(true); setActionError("");
    try {
      await persistSelection(id);
      if (destination || contestId) navigate(destination ?? "/");
    } catch { setActionError("切换队伍失败，请重试。"); }
    finally { setSwitching(false); }
  }
  function follow(event: MouseEvent<HTMLElement>) {
    if (event.defaultPrevented || event.button || event.metaKey || event.altKey || event.shiftKey || event.ctrlKey) return;
    const anchor = event.target instanceof Element ? event.target.closest("a") : null;
    if (!anchor || anchor.target || anchor.hasAttribute("download")) return;
    const url = new URL(anchor.href);
    if (url.origin !== location.origin || url.hash || url.search ||
        !(/^\/contest\/[\w-]+(?:\/print\/[\w-]+)?$/.test(url.pathname) || ["/", "/team", "/account"].includes(url.pathname))) return;
    event.preventDefault();
    const nextPrint = /^\/contest\/([\w-]+)\/print\/([\w-]+)$/.exec(url.pathname);
    if (nextPrint) {
      returnState.current = !printId && nextPrint[1] === contestId
        ? { contestId, printId: nextPrint[2], scrollY: window.scrollY } : null;
    } else if (!printId || url.pathname !== `/contest/${contestId}`) {
      returnState.current = null;
    }
    if (contestId && url.pathname === "/" && team) void select(team.id, "/");
    else navigate(url.pathname);
  }
  async function join(teamId: string) { await persistSelection(teamId); navigate("/"); }
  async function createTeam(name: string) {
    const created = await api<Team>("/api/teams", { method: "POST", body: JSON.stringify({ name }) });
    try {
      await persistSelection(created.id);
      navigate("/");
    } catch {
      refresh();
      setActionError("队伍已创建。请在顶部队伍菜单中选择新队伍。");
    }
  }

  function updateInvitation(url: string) {
    if (!team) return;
    setSnapshot(current => {
      if (!current) return current;
      const teams = current.data.teams.map(t => t.id === team.id ? { ...t, invitationUrl: url } : t);
      return { ...current, data: { ...current.data, teams } };
    });
  }

  const create = () => dialog.current?.showModal();
  const navigation = <Header>{scoped && data && <TeamSwitcher teams={data.teams} selected={team}
    pending={switching} select={id => void select(id)} create={create}/>}</Header>;
  const message = error || actionError;
  function loading() {
    if (failed?.key !== contestId) {
      return <p className="vp-meta" role="status">正在读取{contestId ? "比赛" : "工作台"}…</p>;
    }
    const denied = Boolean(contestId) && failed.denied;
    return <section className="unavailable">
      <h1>{denied ? "无法访问比赛" : contestId ? "无法读取比赛" : "无法读取工作台"}</h1>
      <p className="vp-note">{denied ? "比赛可能已删除，或你尚未加入这支队伍。" : "请检查网络后重试。"}</p>
      <button className="vp-text-action" onClick={refresh}>重新加载</button>
      {contestId && <a className="vp-text-action" href="/">返回工作台</a>}
    </section>;
  }

  function contestView() {
    if (!data?.contest) return <main className="files-shell">{loading()}</main>;
    const props = { contestId, contestName: data.contest.name, createdAt: data.contest.createdAt, navigate: follow };
    if (printId) return <PrintPage key={printId} {...props} printId={printId} noticeId={noticeId}/>;
    return <PrintList key={contestId} {...props} returnHref="/" version={listVersion} returnState={returnState.current?.contestId === contestId ? returnState.current : null}/>;
  }

  function workspaceView() {
    if (account) return <>
      <AccountSettings name={member.name} email={member.email}/>
      <button type="button" className="mobile-signout settings-action" disabled={pending} onClick={signOut}>
        <LogOut size={15}/>退出登录
      </button>
    </>;
    if (invite) return <InvitePage key={invite[1]} token={invite[1]} onJoined={join}/>;
    if (!data) return loading();
    if (!teamPage) return <ContestWorkspace key={team?.id} team={team} contests={data.contests} refresh={refresh} createTeam={create}/>;
    if (!team) return <section className="vp-settings">
      <header className="vp-heading"><h1>队伍设置</h1></header>
      <div className="settings-panel teams-empty">请先创建队伍或通过邀请链接加入。
        <button className="settings-action" onClick={create}>新建队伍</button>
      </div>
    </section>;
    return <TeamManagement key={team.id} teamId={team.id} role={team.role} memberId={member.id}
      invitationUrl={team.invitationUrl} onInvitationChange={updateInvitation} onTeamChanged={refresh}/>;
  }

  return <div onClick={follow}>
    {navigation}
    {message && <p role="alert" className="workspace-alert vp-error">{message}</p>}
    {match ? contestView() : <div className="vp-layout">
      <Sidebar path={path} name={member.name} email={member.email} signOut={signOut} pending={pending}/>
      <main className="vp-main">{workspaceView()}</main>
    </div>}
    <CreateTeamDialog dialog={dialog} create={createTeam}/>
  </div>;
}
