import { useEffect, useState } from "react";
import { ChevronRight, UsersRound } from "lucide-react";
import { api, ApiError } from "./api";
import { Button } from "./components/ui/button";

interface InvitationPreview {
  teamId: string;
  teamName: string;
  ownerName: string | null;
  memberCount: number;
  contestCount: number;
  printoutCount: number;
  joined: boolean;
}

function invalidInvitationError(cause: unknown) {
  return cause instanceof ApiError && cause.status === 404;
}

export function InvitePage({
  token,
  onJoined,
}: {
  token: string;
  onJoined: (teamId: string) => Promise<void>;
}) {
  const [preview, setPreview] = useState<InvitationPreview | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [checked, setChecked] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [actionError, setActionError] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let active = true;
    setPreview(null);
    setInvalid(false);
    setChecked(false);
    setActionError("");

    api<InvitationPreview>(`/api/team-invitations/${token}`)
      .then((body) => {
        if (active) {
          setPreview(body);
          setChecked(true);
        }
      })
      .catch((cause: unknown) => {
        if (!active) return;
        if (invalidInvitationError(cause)) setInvalid(true);
        else setActionError("邀请读取失败，请稍后重试。");
        setChecked(true);
      });

    return () => {
      active = false;
    };
  }, [token, attempt]);

  async function join() {
    if (!preview || pending) return;
    setPending(true);
    setActionError("");
    try {
      if (!preview.joined) {
        const team = await api<{ id: string }>(`/api/team-invitations/${token}/join`, {
          method: "POST",
          body: "{}",
        });
        await onJoined(team.id);
      } else {
        await onJoined(preview.teamId);
      }
    } catch (cause) {
      if (invalidInvitationError(cause)) setInvalid(true);
      else setActionError(cause instanceof Error ? cause.message : "加入队伍失败，请稍后重试。");
    } finally {
      setPending(false);
    }
  }

  if (!checked) {
    return (
      <div className="invite-flow" aria-busy="true">
        <header className="vp-heading">
          <div>
            <h1>加入队伍</h1>
            <p>正在读取邀请…</p>
          </div>
        </header>
        {actionError && <p className="vp-error" role="alert">{actionError}</p>}
      </div>
    );
  }

  if (invalid) {
    return (
      <div className="invite-flow">
        <header className="vp-heading">
          <div>
            <h1>加入队伍</h1>
            <p>这条邀请链接无效。</p>
          </div>
        </header>
        <section className="vp-panel teams-invalid-invite">
          <p className="vp-error">邀请不存在或已被重置。请向队伍队长索取新的邀请链接。</p>
          <a className="teams-heading-action" href="/workspace">
            返回工作台
            <ChevronRight size={15} aria-hidden="true" />
          </a>
        </section>
      </div>
    );
  }

  if (!preview) return <section className="invite-flow">
    <header className="vp-heading"><h1>加入队伍</h1></header>
    <p className="vp-error" role="alert">{actionError}</p>
    <Button variant="outline" onClick={() => setAttempt(value => value + 1)}>重新加载</Button>
  </section>;

  return (
    <div className="invite-flow">
      <header className="vp-heading">
        <div>
          <h1>加入队伍</h1>
        </div>
      </header>
      <section className="vp-panel teams-invite-card">
        <span className="teams-invite-icon" aria-hidden="true">
          <UsersRound size={24} />
        </span>
        <h2>{preview.teamName}</h2>
        <p className="vp-meta">
          队长 {preview.ownerName ?? "待任命"} · {preview.memberCount} 名队员
        </p>
        <p className="teams-invite-summary">
          {preview.contestCount} 场比赛 · {preview.printoutCount} 份打印件
        </p>
        <p className="vp-note">加入后可以创建比赛、阅读队内打印件。</p>
        <Button className="vp-primary" disabled={pending} onClick={() => void join()}>
          {preview.joined ? "进入队伍" : "加入队伍"}
        </Button>
        {actionError && <p className="vp-error" role="alert">{actionError}</p>}
      </section>
    </div>
  );
}
