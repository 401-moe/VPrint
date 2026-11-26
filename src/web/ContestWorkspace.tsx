import { contestPath } from "./workspace-routes";
import { type FormEvent, useState } from "react";
import { ArrowLeft, ChevronRight, FolderOpen, Plus, Settings, Users } from "lucide-react";
import { toast } from "sonner";
import { api } from "./api";
import type { ContestSummary, TeamSummary, WorkspaceTeam } from "../shared/workspace";
import { Button, buttonClassName } from "./ui/button";
import { DialogContent, DialogRoot } from "./ui/dialog";
import { Input } from "./ui/input";

const timestamp = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function UserTeamsPage({
  memberName,
  teams,
  onOpenCreateTeam,
}: {
  memberName: string;
  teams: TeamSummary[];
  onOpenCreateTeam: () => void;
}) {
  return (
    <main className="vp-page">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="vp-page-title">
            我的队伍
          </h1>
          <p className="mt-1 text-[13px] text-[var(--muted)] vp-num">
            <span className="wrap-anywhere">{memberName}</span> · 已加入 {teams.length} 支队伍
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a
            href="/account"
            className={buttonClassName({ variant: "secondary" })}
          >
            <Settings size={14} aria-hidden="true" />
            <span>账号设置</span>
          </a>
          <Button variant="primary" onClick={onOpenCreateTeam}>
            <Plus size={14} aria-hidden="true" />
            <span>新建队伍</span>
          </Button>
        </div>
      </div>

      <section className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
        {teams.length === 0 ? (
          <div className="px-6 py-12 text-center space-y-3">
            <Users
              size={22}
              className="mx-auto text-[var(--faint)]"
              aria-hidden="true"
            />
            <p className="text-[14px] text-[var(--muted)]">
              你还没有加入队伍。可以创建队伍，或打开队长发来的邀请链接。
            </p>
            <Button variant="primary" onClick={onOpenCreateTeam}>
              <Plus size={14} aria-hidden="true" />
              <span>新建队伍</span>
            </Button>
          </div>
        ) : (
          <ul aria-label="队伍" className="divide-y divide-[var(--rule)]">
            {teams.map((team) => (
              <li key={team.id}>
                <a
                  href={`/team/${team.id}`}
                  className="flex w-full items-center justify-between gap-4 px-5 py-4 vp-hover-row pointer-coarse:min-h-[56px]"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[15px] font-medium text-[var(--text)]">
                        {team.name}
                      </span>
                      <span className="rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--raised)] px-2 py-0.5 text-[12px] font-medium text-[var(--muted)]">
                        {team.role === "owner" ? "队长" : "队员"}
                      </span>
                    </div>
                    <p className="mt-1 text-[13px] text-[var(--faint)] vp-num">
                      {team.memberCount} 名队员
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3 text-[13px] text-[var(--muted)] vp-num">
                    <span>{team.contestCount} 场</span>
                    <ChevronRight
                      size={15}
                      className="text-[var(--faint)]"
                      aria-hidden="true"
                    />
                  </div>
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

export function TeamContestsPage({
  team,
  contests,
  refresh,
}: {
  team: WorkspaceTeam;
  contests: ContestSummary[];
  refresh: () => void;
}) {
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function create(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const trimmed = name.trim();
      await api(`/api/teams/${team.id}/contests`, {
        method: "POST",
        body: JSON.stringify({ name: trimmed }),
      });
      setCreateOpen(false);
      setName("");
      toast.success(`已创建比赛「${trimmed}」`);
      refresh();
    } catch {
      setError("创建比赛失败，请重试。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="vp-page">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <a
            href="/workspace"
            className={buttonClassName({
              variant: "ghost",
              compact: true,
              className: "vp-page-back",
            })}
          >
            <ArrowLeft size={14} aria-hidden="true" />
            <span>返回所有队伍</span>
          </a>
          <h1 className="vp-page-title">
            比赛列表
          </h1>
          <p className="mt-1 text-[13px] text-[var(--muted)] vp-num">
            {team.name} · {contests.length} 场比赛
          </p>
        </div>

        <div className="flex items-center gap-2">
          <a
            href={`/team/${team.id}/settings`}
            className={buttonClassName({ variant: "secondary" })}
          >
            <Settings size={14} aria-hidden="true" />
            <span>队伍设置</span>
          </a>
          <Button
            variant="primary"
            disabled={busy}
            onClick={() => {
              setError("");
              setCreateOpen(true);
            }}
          >
            <Plus size={14} aria-hidden="true" />
            <span>新建比赛</span>
          </Button>
        </div>
      </div>

      <section className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
        {contests.length === 0 ? (
          <div className="px-6 py-12 text-center space-y-3">
            <FolderOpen
              size={22}
              className="mx-auto text-[var(--faint)]"
              aria-hidden="true"
            />
            <p className="text-[14px] text-[var(--muted)]">
              还没有比赛。新建比赛后，就可以从 CLI 打印。
            </p>
            <Button
              variant="primary"
              onClick={() => {
                setError("");
                setCreateOpen(true);
              }}
            >
              <Plus size={14} aria-hidden="true" />
              <span>新建比赛</span>
            </Button>
          </div>
        ) : (
          <ul aria-label="比赛" className="divide-y divide-[var(--rule)]">
            {contests.map((contest) => (
              <li key={contest.id}>
                <a
                  href={contestPath(team.id, contest.id)}
                  className="flex w-full items-center justify-between gap-4 px-5 py-3.5 vp-hover-row min-h-[46px] pointer-coarse:min-h-[48px]"
                >
                  <span className="min-w-0 font-medium text-[var(--text)]">
                    {contest.name}
                  </span>
                  <span className="flex shrink-0 items-center gap-4 text-[13px] text-[var(--muted)] vp-num">
                    <span>{contest.printCount} 份</span>
                    <time
                      dateTime={new Date(contest.createdAt).toISOString()}
                      className="text-right text-[var(--faint)]"
                    >
                      {timestamp.format(contest.createdAt)}
                    </time>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      <DialogRoot
        open={createOpen}
        onOpenChange={(next) => {
          if (busy && !next) return;
          setCreateOpen(next);
          if (!next) {
            setName("");
            setError("");
          }
        }}
      >
        <DialogContent
          title="新建比赛"
          description={`将在「${team.name}」下创建新的打印件文件夹。`}
          dismissible={!busy}
        >
          <form onSubmit={create} className="space-y-4">
            <div>
              <label
                htmlFor="create-contest-title"
                className="mb-1.5 block text-[13px] font-medium text-[var(--text)]"
              >
                比赛名称
              </label>
              <Input
                id="create-contest-title"
                name="contest_title"
                required
                maxLength={100}
                placeholder="例如：周六训练 · 区域赛 VP"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
            </div>

            {error && (
              <p className="text-[13px] text-[var(--negative)]" role="alert">
                {error}
              </p>
            )}

            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => setCreateOpen(false)}
              >
                取消
              </Button>
              <Button
                variant="primary"
                type="submit"
                disabled={busy || !name.trim()}
              >
                创建比赛
              </Button>
            </div>
          </form>
        </DialogContent>
      </DialogRoot>
    </main>
  );
}
