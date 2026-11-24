import { FormEvent, useEffect, useState } from "react";

interface Teammate {
  id: string;
  name: string;
  role: string;
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

export function TeamManagement({
  teamId,
  role,
  invitationUrl,
  onInvitationChange,
  onLeftTeam,
}: {
  teamId: string;
  role: string;
  invitationUrl: string;
  onInvitationChange: (invitationUrl: string) => void;
  onLeftTeam: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [teammates, setTeammates] = useState<Teammate[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const owner = role === "owner";

  useEffect(() => {
    if (!open || !owner) return;
    let active = true;

    fetch(`/api/teams/${teamId}/members`)
      .then(async (response) => {
        const body = (await response.json()) as { members?: Teammate[]; error?: string };
        if (!response.ok) throw new Error(body.error ?? "队员列表加载失败。");
        return body.members ?? [];
      })
      .then((members) => {
        if (active) setTeammates(members);
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : "队员列表加载失败。");
      });

    return () => {
      active = false;
    };
  }, [open, owner, teamId]);

  async function run(action: () => Promise<void>) {
    setPending(true);
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "请求失败，请稍后重试。");
    } finally {
      setPending(false);
    }
  }

  function resetInvitation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void run(async () => {
      const body = (await requestJson(`/api/teams/${teamId}/invitation`, {
        method: "POST",
        body: "{}",
      })) as { invitationUrl: string };
      onInvitationChange(body.invitationUrl);
    });
  }

  function removeTeammate(teammateId: string) {
    void run(async () => {
      const result = await requestJson(`/api/teams/${teamId}/members/${teammateId}`, { method: "DELETE" }) as { invitationUrl: string };
      onInvitationChange(result.invitationUrl);
      setTeammates((current) => current.filter((teammate) => teammate.id !== teammateId));
    });
  }

  function leaveTeam() {
    void run(async () => {
      await requestJson(`/api/teams/${teamId}/membership`, { method: "DELETE" });
      onLeftTeam();
    });
  }

  return (
    <section className="team-settings" aria-label="队伍设置">
      <button
        className="button secondary"
        type="button"
        aria-expanded={open}
        aria-controls="team-settings-body"
        onClick={() => setOpen((current) => !current)}
      >
        队伍设置
      </button>
      {open && (
        <div className="team-settings-body" id="team-settings-body">
          {owner ? (
            <>
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
                <form className="reset-form" onSubmit={resetInvitation}>
                  <button className="button secondary" type="submit" disabled={pending}>
                    重置邀请
                  </button>
                </form>
              </div>
              <div className="member-list" role="table" aria-label="队员">
                <div role="row">
                  <span role="columnheader">姓名</span>
                  <span role="columnheader">角色</span>
                  <span role="columnheader">操作</span>
                </div>
                {teammates.map((teammate) => (
                  <div role="row" key={teammate.id}>
                    <span role="cell">{teammate.name}</span>
                    <span role="cell">
                      {teammate.role === "owner" ? "队长" : "队员"}
                    </span>
                    <span role="cell">{teammate.role === "member" && <button
                      className="button secondary"
                      type="button"
                      disabled={pending}
                      onClick={() => removeTeammate(teammate.id)}
                    >
                      移除
                    </button>}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <button
              className="button secondary"
              type="button"
              onClick={leaveTeam}
              disabled={pending}
            >
              退出队伍
            </button>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
