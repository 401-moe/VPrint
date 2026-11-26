import { useEffect, useState } from "react";
import { ArrowLeft, ChevronRight, UsersRound } from "lucide-react";
import { api, ApiError } from "./api";
import { Button, buttonClassName } from "./ui/button";

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
        const team = await api<{ id: string }>(
          `/api/team-invitations/${token}/join`,
          {
            method: "POST",
            body: "{}",
          },
        );
        await onJoined(team.id);
      } else {
        await onJoined(preview.teamId);
      }
    } catch (cause) {
      if (invalidInvitationError(cause)) setInvalid(true);
      else
        setActionError(
          cause instanceof Error ? cause.message : "加入队伍失败，请稍后重试。",
        );
    } finally {
      setPending(false);
    }
  }

  if (!checked) {
    return (
      <main className="vp-page" aria-busy="true">
        <header className="mb-5">
          <h1 className="vp-page-title">
            加入队伍
          </h1>
          <p className="mt-1 text-[13px] text-[var(--muted)]">正在读取邀请…</p>
        </header>
        {actionError && (
          <p className="text-[13px] text-[var(--negative)]" role="alert">
            {actionError}
          </p>
        )}
      </main>
    );
  }

  if (invalid) {
    return (
      <main className="vp-page">
        <header className="mb-5">
          <h1 className="vp-page-title">
            加入队伍
          </h1>
          <p className="mt-1 text-[13px] text-[var(--muted)]">这条邀请链接无效。</p>
        </header>
        <section className="max-w-[520px] rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] vp-form-padding space-y-4">
          <p className="text-[13px] text-[var(--negative)]">
            邀请不存在或已被重置。请向队伍队长索取新的邀请链接。
          </p>
          <a
            className="inline-flex items-center gap-1 text-[13px] font-medium text-[var(--accent)] hover:underline"
            href="/workspace"
          >
            <span>返回所有队伍</span>
            <ChevronRight size={15} aria-hidden="true" />
          </a>
        </section>
      </main>
    );
  }

  if (!preview) {
    return (
      <main className="vp-page space-y-4">
        <header>
          <h1 className="vp-page-title">
            加入队伍
          </h1>
        </header>
        <p className="text-[13px] text-[var(--negative)]" role="alert">
          {actionError}
        </p>
        <Button
          variant="secondary"
          onClick={() => setAttempt((value) => value + 1)}
        >
          重新加载
        </Button>
      </main>
    );
  }

  return (
    <main className="vp-page">
      <div className="mb-5">
        <a
          href="/workspace"
          className={buttonClassName({ variant: "ghost", compact: true, className: "vp-page-back" })}
        >
          <ArrowLeft size={14} aria-hidden="true" />
          <span>返回所有队伍</span>
        </a>
        <h1 className="vp-page-title">
          加入队伍
        </h1>
      </div>

      <section className="max-w-[520px] rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-6 space-y-4">
        <div className="inline-flex size-10 items-center justify-center rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--raised)] text-[var(--text)]">
          <UsersRound size={20} aria-hidden="true" />
        </div>

        <div>
          <h2 className="text-[18px] font-semibold text-[var(--text)]">
            {preview.teamName}
          </h2>
          <p className="mt-1 text-[13px] text-[var(--muted)] vp-num">
            队长 {preview.ownerName ?? "待任命"} · {preview.memberCount} 名队员
          </p>
          <p className="mt-1 text-[13px] text-[var(--muted)] vp-num">
            {preview.contestCount} 场比赛 · {preview.printoutCount} 份打印件
          </p>
        </div>

        <p className="text-[13px] text-[var(--muted)]">
          加入后可以创建比赛、阅读队内打印件。
        </p>

        <Button
          variant="primary"
          className="h-9 w-full"
          disabled={pending}
          onClick={() => void join()}
        >
          {preview.joined ? "进入队伍" : "加入队伍"}
        </Button>

        {actionError && (
          <p className="text-[13px] text-[var(--negative)]" role="alert">
            {actionError}
          </p>
        )}
      </section>
    </main>
  );
}
