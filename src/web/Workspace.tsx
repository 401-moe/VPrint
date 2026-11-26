import { type FormEvent, type MouseEvent, useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "./api";
import { AccountSettings } from "./AccountSettings";
import { ContestSettings, PrintList, PrintPage } from "./ContestPrints";
import {
  TeamContestsPage,
  UserTeamsPage,
} from "./ContestWorkspace";
import { InvitePage } from "./InvitePage";
import { BreadcrumbHeader } from "./Shell";
import { TeamManagement } from "./TeamManagement";
import { Button } from "./ui/button";
import { DialogContent, DialogRoot } from "./ui/dialog";
import { Input } from "./ui/input";
import { usePrintNotifications } from "./use-print-notifications";
import { contestPath, contestRoute, teamRoute } from "./workspace-routes";

import type { WorkspaceData } from "../shared/workspace";

type Member = { id: string; name: string; email: string };

export function Workspace({
  member,
  pending,
  error,
  signOut,
}: {
  member: Member;
  pending: boolean;
  error: string | null;
  signOut: () => void;
}) {
  const [path, setPath] = useState(location.pathname);

  const contestMatch = contestRoute.exec(path)?.groups;
  const teamMatch = teamRoute.exec(path)?.groups;
  const routeTeamId = contestMatch?.teamId ?? teamMatch?.teamId ?? "";
  const contestId = contestMatch?.contestId ?? "";
  const printId = contestMatch?.printId ?? "";
  const contestSettings = Boolean(contestMatch?.settings);
  const routeTeamSettings = Boolean(teamMatch?.settings);
  const contestHref = contestPath(routeTeamId, contestId);

  const invite = /^\/invite\/([^/]+)$/.exec(path);
  const isInvite = Boolean(invite);
  const account = path === "/account";
  const scoped = !account && !isInvite;

  const query = new URLSearchParams();
  if (routeTeamId) query.set("teamId", routeTeamId);
  if (contestId) query.set("contestId", contestId);
  if (routeTeamSettings) query.set("view", "settings");
  const queryKey = query.toString();

  const [snapshot, setSnapshot] = useState<{
    key: string;
    data: WorkspaceData;
  }>();
  const data = snapshot?.key === queryKey ? snapshot.data : undefined;
  const team = data && data.scope !== "user" ? data.team : undefined;
  const contest = data?.scope === "contest" ? data.contest : undefined;
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((v) => v + 1), []);
  const [failed, setFailed] = useState<{ key: string; denied: boolean } | null>(
    null,
  );
  const [createTeamOpen, setCreateTeamOpen] = useState(false);
  const [newTeamName, setNewTeamName] = useState("");
  const [creatingTeam, setCreatingTeam] = useState(false);
  const [createTeamError, setCreateTeamError] = useState("");

  const [listVersion, setListVersion] = useState(0);
  const [noticeId, setNoticeId] = useState("");
  const returnState = useRef<{
    contestId: string;
    printId: string;
    scrollY: number;
  } | null>(null);

  usePrintNotifications(
    contest?.id ?? "",
    Boolean(printId),
    (notice) => {
      if (notice.type === "reload") setListVersion((v) => v + 1);
      if (notice.type === "toast" && notice.id) setNoticeId(notice.id);
    },
  );

  useEffect(() => {
    if (!scoped) return;
    const controller = new AbortController();
    setFailed(null);
    api<WorkspaceData>(queryKey ? `/api/workspace?${queryKey}` : "/api/workspace", {
      signal: controller.signal,
    })
      .then((value) => {
        if (controller.signal.aborted) return;
        setSnapshot({ key: queryKey, data: value });
      })
      .catch((cause) => {
        if (controller.signal.aborted) return;
        setSnapshot(undefined);
        setFailed({
          key: queryKey,
          denied: cause instanceof ApiError && [403, 404].includes(cause.status),
        });
      });
    return () => controller.abort();
  }, [queryKey, scoped, revision]);

  useEffect(() => {
    const restore = () => {
      setPath(location.pathname);
      setNoticeId("");
    };
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, []);

  useEffect(() => {
    if (!team?.id) return;
    // Remembering the team is a preference. Navigation succeeds independently.
    void api(`/api/teams/${team.id}/selection`, { method: "PUT", body: "{}" })
      .catch(() => undefined);
  }, [team?.id]);

  useEffect(() => {
    const titlePrefix = account
      ? "账号设置"
      : routeTeamSettings
        ? "队伍设置"
        : isInvite
          ? "队伍邀请"
          : contestSettings
            ? "比赛设置"
            : contest?.name ||
              (routeTeamId ? team?.name : undefined) ||
              "我的队伍";
    document.title = `${titlePrefix} · VPrint`;
  }, [
    account,
    routeTeamSettings,
    isInvite,
    contestSettings,
    routeTeamId,
    contest?.name,
    team?.name,
  ]);

  function navigate(to: string) {
    if (location.pathname !== to) history.pushState(null, "", to);
    setPath(to);
    setNoticeId("");
    if (!printId || to !== contestHref) window.scrollTo(0, 0);
  }

  function follow(event: MouseEvent<HTMLElement>) {
    if (
      event.defaultPrevented ||
      event.button ||
      event.metaKey ||
      event.altKey ||
      event.shiftKey ||
      event.ctrlKey
    ) {
      return;
    }
    const anchor =
      event.target instanceof Element ? event.target.closest("a") : null;
    if (!anchor || anchor.target || anchor.hasAttribute("download")) return;
    const url = new URL(anchor.href);
    if (url.origin !== location.origin || url.hash || url.search) return;

    const nextContest = contestRoute.exec(url.pathname)?.groups;
    const internal = nextContest || teamRoute.test(url.pathname) ||
      ["/workspace", "/teams", "/account"].includes(url.pathname);
    if (!internal) return;

    event.preventDefault();
    if (
      nextContest?.printId &&
      path === contestHref &&
      path === contestPath(nextContest.teamId, nextContest.contestId)
    ) {
      returnState.current = { contestId, printId: nextContest.printId, scrollY: window.scrollY };
    } else if (!printId || url.pathname !== contestHref) {
      returnState.current = null;
    }
    navigate(url.pathname);
  }

  function join(teamId: string) {
    if (location.pathname === path) navigate(`/team/${teamId}`);
    else refresh();
  }

  async function createTeam(event: FormEvent) {
    event.preventDefault();
    const trimmed = newTeamName.trim();
    if (!trimmed || creatingTeam) return;
    setCreatingTeam(true);
    setCreateTeamError("");
    try {
      const created = await api<{ id: string }>("/api/teams", {
        method: "POST",
        body: JSON.stringify({ name: trimmed }),
      });
      setCreateTeamOpen(false);
      setNewTeamName("");
      navigate(`/team/${created.id}`);
    } catch {
      setCreateTeamError("创建队伍失败，请重试。");
    } finally {
      setCreatingTeam(false);
    }
  }

  function updateInvitation(url: string) {
    setSnapshot((current) => {
      if (current?.key !== queryKey || current.data.scope !== "team-settings") return current;
      return { ...current, data: { ...current.data, invitationUrl: url } };
    });
  }

  function loading() {
    if (failed?.key !== queryKey) {
      return (
        <main className="vp-page">
          <p className="text-[13px] text-[var(--muted)]" role="status">
            正在读取{contestId ? "比赛" : routeTeamId ? "队伍" : "工作区"}…
          </p>
        </main>
      );
    }
    const denied = Boolean(contestId || routeTeamId) && failed.denied;
    const headingText = contestId
      ? denied
        ? "无法访问比赛"
        : "无法读取比赛"
      : routeTeamId
        ? denied
          ? "无法访问队伍"
          : "无法读取队伍"
        : "无法读取工作区";
    const description = denied
      ? contestId
        ? "比赛可能已删除，或你尚未加入这支队伍。"
        : "队伍可能已解散，或你尚未加入这支队伍。"
      : "请检查网络后重试。";

    return (
      <main className="vp-page">
        <section className="max-w-[520px] rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-6 space-y-4">
          <div>
            <h1 className="text-[20px] font-semibold text-[var(--text)]">
              {headingText}
            </h1>
            <p className="mt-1.5 text-[13px] text-[var(--muted)]">
              {description}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="secondary" onClick={refresh}>
              重新加载
            </Button>
            {(contestId || routeTeamId) && (
              <a
                className="text-[13px] font-medium text-[var(--accent)] hover:underline"
                href="/workspace"
              >
                返回所有队伍
              </a>
            )}
          </div>
        </section>
      </main>
    );
  }

  function renderContent() {
    if (account) {
      return (
        <AccountSettings
          name={member.name}
          email={member.email}
          pending={pending}
          signOut={signOut}
        />
      );
    }

    if (invite) {
      return <InvitePage key={invite[1]} token={invite[1]} onJoined={join} />;
    }

    if (!data) return loading();

    if (data.scope === "contest") {
      const { team, contest } = data;
      const teamHref = `/team/${team.id}`;
      if (contestSettings) {
        return (
          <ContestSettings
            contestId={contestId}
            contestHref={contestHref}
            contestName={contest.name}
            teamId={team.id}
            teamName={team.name}
            owner={team.role === "owner"}
            navigate={follow}
            onUpdated={refresh}
            onDeleted={() => {
              setSnapshot(undefined);
              refresh();
              navigate(teamHref);
            }}
          />
        );
      }
      if (printId) {
        return (
          <PrintPage
            key={printId}
            contestId={contestId}
            contestHref={contestHref}
            contestName={contest.name}
            createdAt={contest.createdAt}
            printId={printId}
            noticeId={noticeId}
            navigate={follow}
          />
        );
      }
      return (
        <PrintList
          key={contestId}
          contestId={contestId}
          contestHref={contestHref}
          contestName={contest.name}
          createdAt={contest.createdAt}
          teamHref={teamHref}
          version={listVersion}
          navigate={follow}
          returnState={
            returnState.current?.contestId === contestId
              ? returnState.current
              : null
          }
        />
      );
    }

    if (data.scope === "team-settings") {
      const { team } = data;
      return (
        <TeamManagement
          key={team.id}
          teamId={team.id}
          teamName={team.name}
          role={team.role}
          memberId={member.id}
          memberName={member.name}
          invitationUrl={data.invitationUrl}
          onInvitationChange={updateInvitation}
          onTeamChanged={refresh}
          onTeamDissolved={() => {
            setSnapshot(undefined);
            refresh();
            navigate("/workspace");
          }}
        />
      );
    }

    if (data.scope === "team") {
      const { team } = data;
      return (
        <TeamContestsPage
          key={team.id}
          team={team}
          contests={data.contests}
          refresh={refresh}
        />
      );
    }

    return (
      <UserTeamsPage
        memberName={member.name}
        teams={data.teams}
        onOpenCreateTeam={() => {
          setCreateTeamError("");
          setCreateTeamOpen(true);
        }}
      />
    );
  }

  return (
    <div onClick={follow}>
      <BreadcrumbHeader
        memberName={member.name}
        team={team}
        contest={contest}
        accountActive={account}
      />

      {error && (
        <div className="vp-frame pt-4">
          <p
            role="alert"
            className="rounded-[var(--radius-control)] border border-[var(--negative)]/35 bg-[var(--surface)] px-4 py-2.5 text-[13px] text-[var(--negative)]"
          >
            {error}
          </p>
        </div>
      )}

      {renderContent()}

      <DialogRoot
        open={createTeamOpen}
        onOpenChange={(next) => {
          if (creatingTeam && !next) return;
          setCreateTeamOpen(next);
          if (!next) {
            setNewTeamName("");
            setCreateTeamError("");
          }
        }}
      >
        <DialogContent
          title="新建队伍"
          description="创建后你可以通过邀请链接邀请队友加入。"
          dismissible={!creatingTeam}
        >
          <form onSubmit={createTeam} className="space-y-4">
            <div>
              <label
                htmlFor="create-team-title"
                className="mb-1.5 block text-[13px] font-medium text-[var(--text)]"
              >
                队伍名称
              </label>
              <Input
                id="create-team-title"
                name="team_title"
                required
                maxLength={100}
                placeholder="例如：西安交大 · 集训一队"
                value={newTeamName}
                onChange={(e) => setNewTeamName(e.target.value)}
                autoFocus
              />
            </div>

            {createTeamError && (
              <p className="text-[13px] text-[var(--negative)]" role="alert">
                {createTeamError}
              </p>
            )}

            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                disabled={creatingTeam}
                onClick={() => setCreateTeamOpen(false)}
              >
                取消
              </Button>
              <Button
                variant="primary"
                type="submit"
                disabled={creatingTeam || !newTeamName.trim()}
              >
                创建队伍
              </Button>
            </div>
          </form>
        </DialogContent>
      </DialogRoot>
    </div>
  );
}
