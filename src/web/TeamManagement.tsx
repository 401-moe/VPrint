import { RenameForm } from "./RenameForm";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, MoreHorizontal, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { api } from "./api";
import { Button, buttonClassName } from "./ui/button";
import { CopyButton } from "./ui/copy-button";
import { DialogContent, DialogRoot } from "./ui/dialog";
import { Input } from "./ui/input";
import { MenuItem, MenuPopup, MenuRoot, MenuTrigger } from "./ui/menu";

interface Teammate {
  id: string;
  name: string;
  role: string;
}

interface TeamDeletePreview {
  name: string;
  contestCount: number;
  printoutCount: number;
}

type Confirmation =
  | { kind: "transfer"; member: Teammate }
  | { kind: "remove"; member: Teammate }
  | { kind: "leave" }
  | { kind: "reset-invite" }
  | { kind: "dissolve"; summary: TeamDeletePreview };

function MemberActions({
  member,
  pending,
  onChoose,
}: {
  member: Teammate;
  pending: boolean;
  onChoose: (confirmation: Confirmation) => void;
}) {
  const openingDialog = useRef(false);

  function choose(kind: "transfer" | "remove") {
    openingDialog.current = true;
    onChoose({ kind, member });
  }

  return (
    <MenuRoot
      onOpenChange={(open) => {
        if (open) openingDialog.current = false;
      }}
    >
      <MenuTrigger
        className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-control)] border border-[var(--control)] bg-[var(--surface)] text-[var(--muted)] hover:text-[var(--text)] vp-hover-surface cursor-pointer pointer-coarse:min-h-11 pointer-coarse:w-11 disabled:opacity-45"
        aria-label={`管理队员 ${member.name}`}
        disabled={pending}
      >
        <MoreHorizontal size={15} aria-hidden="true" />
      </MenuTrigger>
      <MenuPopup
        align="end"
        ariaLabel={`管理队员 ${member.name}`}
        finalFocus={() => !openingDialog.current}
      >
        <MenuItem onClick={() => choose("transfer")}>转让队长</MenuItem>
        <MenuItem
          onClick={() => choose("remove")}
          className="text-[var(--negative-text)]"
        >
          移除队员
        </MenuItem>
      </MenuPopup>
    </MenuRoot>
  );
}

export function TeamManagement({
  teamId,
  teamName,
  role,
  invitationUrl,
  memberId,
  memberName,
  onInvitationChange,
  onRenamed,
  onTeamChanged,
  onTeamDissolved,
}: {
  teamId: string;
  teamName: string;
  role: string;
  invitationUrl: string;
  memberId: string;
  memberName: string;
  onInvitationChange: (invitationUrl: string) => void;
  onRenamed: (name: string) => void;
  onTeamChanged: () => void;
  onTeamDissolved: () => void;
}) {
  const owner = role === "owner";

  const [teammates, setTeammates] = useState<Teammate[]>([]);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [invitationReset, setInvitationReset] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!owner) return;
    let active = true;
    api<{ members: Teammate[] }>(`/api/teams/${teamId}/members`)
      .then((body) => {
        if (active) setTeammates(body.members);
      })
      .catch((cause: unknown) => {
        if (active)
          setError(
            cause instanceof Error ? cause.message : "队员列表加载失败。",
          );
      });
    return () => {
      active = false;
    };
  }, [owner, teamId]);

  async function openDissolvePreview() {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      const summary = await api<TeamDeletePreview>(
        `/api/teams/${teamId}/deletion`,
      );
      setConfirmation({ kind: "dissolve", summary });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法读取解散范围。");
    } finally {
      setPending(false);
    }
  }

  async function executeConfirmation() {
    if (!confirmation || pending) return;
    setPending(true);
    setError("");
    try {
      switch (confirmation.kind) {
        case "reset-invite": {
          const body = await api<{ invitationUrl: string }>(
            `/api/teams/${teamId}/invitation`,
            { method: "POST", body: "{}" },
          );
          onInvitationChange(body.invitationUrl);
          setInvitationReset(true);
          toast.success("邀请链接已重置，旧链接已失效");
          break;
        }
        case "remove": {
          const body = await api<{ invitationUrl: string }>(
            `/api/teams/${teamId}/members/${confirmation.member.id}`,
            { method: "DELETE" },
          );
          onInvitationChange(body.invitationUrl);
          setTeammates((current) => current.filter((m) => m.id !== confirmation.member.id));
          toast(`已移除队员 ${confirmation.member.name}`);
          break;
        }
        case "transfer":
          await api(`/api/teams/${teamId}/ownership`, {
            method: "PUT",
            body: JSON.stringify({ userId: confirmation.member.id }),
          });
          toast.success(`已将队长转让给 ${confirmation.member.name}`);
          onTeamChanged();
          break;
        case "leave":
          await api(`/api/teams/${teamId}/membership`, { method: "DELETE" });
          toast("已退出队伍");
          onTeamDissolved();
          break;
        case "dissolve":
          await api(`/api/teams/${teamId}/deletion`, { method: "DELETE" });
          toast(`已解散队伍「${confirmation.summary.name}」`);
          onTeamDissolved();
          break;
        default:
          throw new Error(`未知的队伍操作：${confirmation satisfies never}`);
      }
      setConfirmation(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "操作失败，请稍后重试。");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="vp-page space-y-6">
      <div>
        <a
          href={`/team/${teamId}`}
          className={buttonClassName({
            variant: "ghost",
            compact: true,
            className: "vp-page-back",
          })}
        >
          <ArrowLeft size={14} aria-hidden="true" />
          <span>返回比赛列表</span>
        </a>
        <h1 className="vp-page-title">
          队伍设置
        </h1>
        <p className="mt-1 text-[13px] text-[var(--muted)]">{teamName}</p>
      </div>

      <section className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-5">
        <h2 className="text-[14px] font-semibold text-[var(--text)]">队伍名称</h2>
        {owner ? (
          <RenameForm kind="team" id={teamId} name={teamName} onRenamed={onRenamed} />
        ) : (
          <p className="mt-2 text-[14px] text-[var(--text)]">{teamName}</p>
        )}
      </section>

      {owner && (
        <section className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-5 space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-[14px] font-semibold text-[var(--text)]">
                邀请链接
              </h2>
              <p className="mt-1 text-[13px] text-[var(--muted)]" role="status">
                {invitationReset ? "链接已重置，旧链接已失效。" : "同一条链接可邀请多人。"}
              </p>
            </div>
            <Button
              variant="ghost"
              compact
              disabled={pending}
              onClick={() => setConfirmation({ kind: "reset-invite" })}
            >
              <RefreshCw size={13} aria-hidden="true" />
              <span>重置链接</span>
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor="team-invite-url" className="sr-only">
              邀请链接
            </label>
            <Input
              id="team-invite-url"
              readOnly
              value={invitationUrl}
              onFocus={(event) => event.target.select()}
              className="min-w-0 flex-1 vp-code-name"
            />
            <CopyButton value={invitationUrl} label="复制链接" />
          </div>
        </section>
      )}

      <section
        className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] overflow-hidden"
        aria-labelledby="members-title"
      >
        <div className="border-b border-[var(--rule)] px-5 py-3.5">
          <h2
            id="members-title"
            className="text-[14px] font-semibold text-[var(--text)] vp-num"
          >
            {owner ? `队员名单 (${teammates.length})` : "我的身份"}
          </h2>
        </div>
        <ul className="divide-y divide-[var(--rule)]">
          {owner ? (
            teammates.map((m) => (
              <li
                key={m.id}
                className="teams-member-row flex items-center justify-between gap-3 px-5 py-3.5"
              >
                <div className="flex min-w-0 items-center gap-2 text-[14px]">
                  <strong className="font-medium text-[var(--text)]">
                    {m.name}
                  </strong>
                  {m.id === memberId && (
                    <span className="text-[12px] text-[var(--faint)]">我</span>
                  )}
                  <span className="rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--raised)] px-2 py-0.5 text-[12px] font-medium text-[var(--muted)]">
                    {m.role === "owner" ? "队长" : "队员"}
                  </span>
                </div>
                {m.id !== memberId && (
                  <MemberActions
                    member={m}
                    pending={pending}
                    onChoose={setConfirmation}
                  />
                )}
              </li>
            ))
          ) : (
            <li className="teams-member-row flex items-center justify-between gap-3 px-5 py-3.5">
              <div className="flex items-center gap-2 text-[14px]">
                <strong className="font-medium text-[var(--text)]">
                  {memberName}
                </strong>
                <span className="text-[12px] text-[var(--faint)]">我</span>
                <span className="rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--raised)] px-2 py-0.5 text-[12px] font-medium text-[var(--muted)]">
                  队员
                </span>
              </div>
            </li>
          )}
        </ul>
      </section>

      <section
        className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-5"
        aria-labelledby="team-danger-title"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2
              id="team-danger-title"
              className="text-[14px] font-semibold text-[var(--text)]"
            >
              {owner ? "解散队伍" : "退出队伍"}
            </h2>
            <p
              id="team-danger-impact"
              className="mt-1 text-[13px] text-[var(--muted)]"
            >
              {owner
                ? "解散后，本队的比赛和打印件将永久删除。"
                : "退出后，你将失去对本队比赛和打印件的访问权限。"}
            </p>
          </div>
          {owner ? (
            <Button
              variant="danger"
              aria-describedby="team-danger-impact"
              disabled={pending}
              onClick={() => void openDissolvePreview()}
            >
              解散队伍
            </Button>
          ) : (
            <Button
              variant="danger"
              aria-describedby="team-danger-impact"
              disabled={pending}
              onClick={() => setConfirmation({ kind: "leave" })}
            >
              退出队伍
            </Button>
          )}
        </div>
      </section>

      {error && (
        <p className="text-[13px] text-[var(--negative)]" role="alert">
          {error}
        </p>
      )}

      <DialogRoot
        open={confirmation !== null}
        onOpenChange={(next) => {
          if (pending && !next) return;
          if (!next) {
            setConfirmation(null);
            setError("");
          }
        }}
      >
        {confirmation && (
          <DialogContent
            title={
              confirmation.kind === "transfer"
                ? "转让队长"
                : confirmation.kind === "remove"
                  ? "移除队员"
                  : confirmation.kind === "reset-invite"
                    ? "重置邀请链接？"
                    : confirmation.kind === "dissolve"
                      ? "解散队伍"
                      : "退出队伍"
            }
            dismissible={!pending}
          >
            <div className="space-y-4">
              {confirmation.kind === "transfer" && (
                <p className="text-[13px] leading-6 text-[var(--muted)]">
                  将队长转让给「{confirmation.member.name}
                  」。你成为队员，比赛和打印件保持不变。
                </p>
              )}
              {confirmation.kind === "remove" && (
                <p className="text-[13px] leading-6 text-[var(--muted)]">
                  移除「{confirmation.member.name}
                  」，并重置邀请链接。对方将不能访问本队比赛。
                </p>
              )}
              {confirmation.kind === "reset-invite" && (
                <p className="text-[13px] leading-6 text-[var(--muted)]">
                  已发出的邀请链接会立即失效，尚未入队的人需要使用新链接。
                </p>
              )}
              {confirmation.kind === "leave" && (
                <p className="text-[13px] leading-6 text-[var(--muted)]">
                  退出后，原邀请链接继续有效。
                </p>
              )}
              {confirmation.kind === "dissolve" && (
                <div className="space-y-2 text-[13px] leading-6 text-[var(--muted)]">
                  <p className="font-medium text-[var(--text)]">
                    {confirmation.summary.name}
                  </p>
                  <p className="vp-num">
                    {confirmation.summary.contestCount} 场比赛、
                    {confirmation.summary.printoutCount} 份打印件将永久删除。
                  </p>
                </div>
              )}

              {error && (
                <p className="text-[13px] text-[var(--negative)]" role="alert">
                  {error}
                </p>
              )}

              <div className="flex justify-end gap-2">
                <Button
                  variant="secondary"
                  autoFocus
                  disabled={pending}
                  onClick={() => setConfirmation(null)}
                >
                  取消
                </Button>
                <Button
                  variant={
                    confirmation.kind === "transfer" ? "primary" : "danger"
                  }
                  disabled={pending}
                  onClick={() => void executeConfirmation()}
                >
                  {confirmation.kind === "reset-invite"
                    ? "确认重置"
                    : confirmation.kind === "dissolve"
                      ? "确认解散队伍"
                      : "确认"}
                </Button>
              </div>
            </div>
          </DialogContent>
        )}
      </DialogRoot>
    </main>
  );
}
