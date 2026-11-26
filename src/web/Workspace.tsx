import { type MouseEvent, useCallback, useEffect, useRef, useState } from "react";
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
  const selection = useRef<{ id: string; write: Promise<void> } | null>(null);
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((v) => v + 1), []);
  const [failed, setFailed] = useState<{ key: string; denied: boolean } | null>(
    null,
  );
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
        if (value.scope === "user" && value.selectedTeamId && !selection.current) {
          selection.current = { id: value.selectedTeamId, write: Promise.resolve() };
        }
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

  const teamId = team?.id;
  useEffect(() => {
    if (!teamId || selection.current?.id === teamId) return;
    // Keep rapid team switches in visit order even if a write is slow.
    const previous = selection.current?.write ?? Promise.resolve();
    const write = previous.then(async () => {
      try {
        await api(`/api/teams/${teamId}/selection`, { method: "PUT", body: "{}" });
        if (selection.current?.write === write && ["/workspace", "/teams"].includes(location.pathname)) {
          refresh();
        }
      } catch {
        if (selection.current?.write === write) selection.current = null;
      }
    });
    selection.current = { id: teamId, write };
  }, [teamId, refresh]);

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

  function enterTeam(teamId: string, form?: HTMLFormElement) {
    if (location.pathname === path && (!form || form.isConnected)) navigate(`/team/${teamId}`);
    else refresh();
  }

  function updateName(name: string) {
    setSnapshot(current => {
      if (current?.key !== queryKey) return current;
      const { data } = current;
      if (data.scope === "contest") {
        return { ...current, data: { ...data, contest: { ...data.contest, name } } };
      }
      if (data.scope === "team-settings") {
        return { ...current, data: { ...data, team: { ...data.team, name } } };
      }
      return current;
    });
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
      return <InvitePage key={invite[1]} token={invite[1]} onJoined={enterTeam} />;
    }

    if (!data) return loading();

    if (data.scope === "contest") {
      const { team, contest } = data;
      const teamHref = `/team/${team.id}`;
      if (contestSettings) {
        return (
          <ContestSettings
            key={contestId}
            contestId={contestId}
            contestHref={contestHref}
            contestName={contest.name}
            teamId={team.id}
            teamName={team.name}
            owner={team.role === "owner"}
            navigate={follow}
            onRenamed={updateName}
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
          onRenamed={updateName}
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
        selectedTeamId={data.selectedTeamId}
        onCreated={enterTeam}
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
    </div>
  );
}
