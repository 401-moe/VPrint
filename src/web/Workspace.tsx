import { FormEvent, useCallback, useEffect, useState } from "react";

interface Member {
  id: string;
  email: string;
  name: string;
}

interface Team {
  id: string;
  name: string;
  role: string;
  invitationUrl: string;
}

interface Contest {
  id: string;
  name: string;
  createdAt: number;
}

interface WorkspaceData {
  teams: Team[];
  selectedTeamId: string | null;
  contests: Contest[];
  contest: Contest | null;
}

const emptyWorkspace: WorkspaceData = {
  teams: [],
  selectedTeamId: null,
  contests: [],
  contest: null,
};

function formatTimestamp(value: number) {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
}

async function requestJson(path: string, init: RequestInit = {}) {
  const response = await fetch(path, {
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
    ...init,
  });
  const body = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(
      typeof body.error === "string" ? body.error : "请求失败，请稍后重试。",
    );
  }
  return body;
}

export function Workspace({
  member,
  error,
  pending,
  signOut,
}: {
  member: Member;
  error: string | null;
  pending: boolean;
  signOut: () => void;
}) {
  const [workspace, setWorkspace] = useState(emptyWorkspace);
  const [teamName, setTeamName] = useState("");
  const [contestName, setContestName] = useState("");
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [workspacePending, setWorkspacePending] = useState(false);
  const [invitationUrl, setInvitationUrl] = useState("");

  const loadWorkspace = useCallback(async (path = "/api/workspace") => {
    try {
      const data = (await requestJson(path)) as unknown as WorkspaceData;
      setWorkspace(data);
      const selected = data.teams.find((team) => team.id === data.selectedTeamId);
      if (selected) setInvitationUrl(selected.invitationUrl);
      return true;
    } catch (cause) {
      setWorkspaceError(cause instanceof Error ? cause.message : "请求失败，请稍后重试。");
      return false;
    }
  }, []);

  useEffect(() => {
    const invitationToken = window.location.pathname.match(/^\/invite\/([a-f0-9]{32})$/)?.[1];
    void loadWorkspace();
    if (!invitationToken) return;

    requestJson(`/api/team-invitations/${invitationToken}/join`, {
      method: "POST",
      body: "{}",
    })
      .then(() => loadWorkspace())
      .catch((cause: unknown) => {
        setWorkspaceError(cause instanceof Error ? cause.message : "邀请链接无效。");
      });
  }, [loadWorkspace]);

  async function createTeam(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setWorkspacePending(true);
    setWorkspaceError(null);

    try {
      const team = (await requestJson("/api/teams", {
        method: "POST",
        body: JSON.stringify({ name: teamName }),
      })) as { id: string; name: string; role: string; invitationUrl: string };
      setTeamName("");
      setInvitationUrl(team.invitationUrl);
      await loadWorkspace();
    } catch (cause) {
      setWorkspaceError(cause instanceof Error ? cause.message : "创建队伍失败。");
    } finally {
      setWorkspacePending(false);
    }
  }

  async function createContest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const teamId = workspace.selectedTeamId;
    if (!teamId) return;
    setWorkspacePending(true);
    setWorkspaceError(null);

    try {
      await requestJson(`/api/teams/${teamId}/contests`, {
        method: "POST",
        body: JSON.stringify({ name: contestName }),
      });
      setContestName("");
      await loadWorkspace();
    } catch (cause) {
      setWorkspaceError(cause instanceof Error ? cause.message : "创建比赛失败。");
    } finally {
      setWorkspacePending(false);
    }
  }

  async function switchTeam(teamId: string) {
    setWorkspacePending(true);
    setWorkspaceError(null);

    try {
      await requestJson(`/api/teams/${teamId}/selection`, {
        method: "PUT",
        body: "{}",
      });
      await loadWorkspace();
    } catch (cause) {
      setWorkspaceError(cause instanceof Error ? cause.message : "切换队伍失败。");
    } finally {
      setWorkspacePending(false);
    }
  }

  const selectedTeam = workspace.teams.find((team) => team.id === workspace.selectedTeamId);
  const busy = pending || workspacePending;
  const displayedError = workspaceError ?? error;

  return (
    <section className="workspace-card" aria-labelledby="workspace-title">
      <header className="workspace-header">
        <div>
          <h1 className="title" id="workspace-title">
            {selectedTeam?.name ?? "工作台"}
          </h1>
          <p className="member-name">{member.email}</p>
        </div>
        <button className="button secondary" onClick={signOut} disabled={pending}>
          退出登录
        </button>
      </header>

      {workspace.teams.length === 0 ? (
        <form className="fields" onSubmit={createTeam}>
          <label className="field">
            队伍名称
            <input
              name="teamName"
              value={teamName}
              onChange={(event) => setTeamName(event.target.value)}
              required
            />
          </label>
          <button className="button" type="submit" disabled={busy}>
            创建队伍
          </button>
        </form>
      ) : (
        <>
          <div className="workspace-toolbar">
            <label className="field">
              当前队伍
              <select
                value={workspace.selectedTeamId ?? undefined}
                onChange={(event) => switchTeam(event.target.value)}
                disabled={busy}
              >
                {workspace.teams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </select>
            </label>
            <p className="role">{selectedTeam?.role === "owner" ? "队长" : "队员"}</p>
          </div>

          <div className="invitation">
            <label className="field">
              邀请链接
              <input
                readOnly
                value={invitationUrl}
                onFocus={(event) => event.target.select()}
              />
            </label>
            <button
              className="button secondary"
              type="button"
              onClick={() => navigator.clipboard.writeText(invitationUrl)}
              disabled={!invitationUrl}
            >
              复制邀请
            </button>
          </div>

          <form className="inline-form" onSubmit={createContest}>
            <label className="field">
              比赛名称
              <input
                name="contestName"
                value={contestName}
                onChange={(event) => setContestName(event.target.value)}
                required
              />
            </label>
            <button className="button" type="submit" disabled={busy}>
              创建比赛
            </button>
          </form>

          <ul className="contest-list" aria-label="比赛">
            {workspace.contests.map((contest) => (
              <li key={contest.id}>
                <a className="contest-link" href={`/contest/${contest.id}`}>
                  {contest.name}
                </a>
                <span>{formatTimestamp(contest.createdAt)}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {displayedError && (
        <p className="error" role="alert">
          {displayedError}
        </p>
      )}
    </section>
  );
}
