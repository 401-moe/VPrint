import { useEffect, useRef, useState } from "react";
import { Menu } from "@base-ui/react/menu";
import { Check, ChevronDown, Copy, RotateCcw, UserPlus, X } from "lucide-react";
import { api } from "./api";
import { Button } from "./components/ui/button";
import { DeleteGroup } from "./DeleteGroup";

interface Teammate {
  id: string;
  name: string;
  role: string;
}

type Confirmation =
  | { kind: "transfer"; member: Teammate }
  | { kind: "remove"; member: Teammate }
  | { kind: "leave" };

type InviteStatus = "idle" | "copying" | "copied" | "reset" | "failed";

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
    <Menu.Root onOpenChange={(open) => {
      if (open) openingDialog.current = false;
    }}>
      <Menu.Trigger
        className="settings-action teams-member-menu"
        aria-label={`管理队员 ${member.name}`}
        disabled={pending}
      >
        管理<ChevronDown size={13} aria-hidden="true" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner className="vp-menu-position" align="end" sideOffset={3}>
          <Menu.Popup
            className="vp-menu"
            aria-label={`管理队员 ${member.name}`}
            finalFocus={() => !openingDialog.current}
          >
            <Menu.Item className="vp-menu-item" onClick={() => choose("transfer")}>
              转让队长
            </Menu.Item>
            <Menu.Item className="vp-menu-item" onClick={() => choose("remove")}>
              移除队员
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

export function TeamManagement({
  teamId,
  role,
  invitationUrl,
  onInvitationChange,
  onTeamChanged,
  memberId,
}: {
  teamId: string;
  role: string;
  invitationUrl: string;
  onInvitationChange: (invitationUrl: string) => void;
  onTeamChanged: () => void;
  memberId: string;
}) {
  const [teammates, setTeammates] = useState<Teammate[]>([]);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [inviteStatus, setInviteStatus] = useState<InviteStatus>("idle");
  const [confirmReset, setConfirmReset] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const confirmationDialog = useRef<HTMLDialogElement>(null);
  const invitationDialog = useRef<HTMLDialogElement>(null);
  const membersHeading = useRef<HTMLHeadingElement>(null);
  const owner = role === "owner";

  useEffect(() => {
    if (!owner) return;
    let active = true;

    api<{ members: Teammate[] }>(`/api/teams/${teamId}/members`)
      .then((body) => {
        if (active) setTeammates(body.members);
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : "队员列表加载失败。");
      });

    return () => {
      active = false;
    };
  }, [owner, teamId]);

  useEffect(() => {
    if (confirmation) confirmationDialog.current?.showModal();
    else confirmationDialog.current?.close();
  }, [confirmation]);

  async function run(action: () => Promise<void>) {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "请求失败，请稍后重试。");
    } finally {
      setPending(false);
    }
  }

  async function copyInvitation() {
    setInviteStatus("copying");
    try {
      await navigator.clipboard.writeText(invitationUrl);
      setInviteStatus("copied");
    } catch {
      setInviteStatus("failed");
    }
  }

  async function resetInvitation() {
    await run(async () => {
      const body = await api<{ invitationUrl: string }>(`/api/teams/${teamId}/invitation`, {
        method: "POST",
        body: "{}",
      });
      onInvitationChange(body.invitationUrl);
      setInviteStatus("reset");
      setConfirmReset(false);
    });
  }

  async function confirmAction() {
    if (!confirmation) return;
    await run(async () => {
      if (confirmation.kind === "remove") {
        const body = await api<{ invitationUrl: string }>(
          `/api/teams/${teamId}/members/${confirmation.member.id}`,
          { method: "DELETE" },
        );
        onInvitationChange(body.invitationUrl);
        setTeammates((current) => current.filter((member) => member.id !== confirmation.member.id));
      } else if (confirmation.kind === "transfer") {
        await api(`/api/teams/${teamId}/ownership`, {
          method: "PUT",
          body: JSON.stringify({ userId: confirmation.member.id }),
        });
        onTeamChanged();
      } else {
        await api(`/api/teams/${teamId}/membership`, { method: "DELETE" });
        onTeamChanged();
      }
      setConfirmation(null);
    });
  }

  return (
    <div className="vp-settings teams-page">
      <header className="vp-heading">
        <div>
          <h1>队伍设置</h1>
        </div>
      </header>

      <section className="vp-section" aria-labelledby="members-title">
        <div className="teams-members-heading">
          <h2 id="members-title" ref={membersHeading} tabIndex={-1}>
            {owner ? "队员" : "我的身份"}
            {owner && <span className="vp-tally">{teammates.length}</span>}
          </h2>
          {owner && (
            <Button
              variant="outline"
              className="settings-action"
              aria-haspopup="dialog"
              onClick={() => {
                setInviteStatus((status) => (status === "copying" ? status : "idle"));
                setConfirmReset(false);
                invitationDialog.current?.showModal();
              }}
            >
              <UserPlus size={15} aria-hidden="true" />邀请队员
            </Button>
          )}
        </div>
        <div className="settings-panel">
          <ul>
            {owner ? teammates.map((member) => (
              <li className="vp-row teams-member-row" key={member.id}>
                <div className="teams-member-name">
                  <strong>{member.name}</strong>
                  {member.id === memberId && <span>我</span>}
                  {member.role === "owner" && <span className="settings-badge">队长</span>}
                </div>
                {owner && member.id !== memberId && (
                  <MemberActions member={member} pending={pending} onChoose={setConfirmation} />
                )}
              </li>
            )) : (
              <li className="vp-row teams-member-row">
                <div className="teams-member-name">
                  <strong>我</strong>
                  <span className="settings-badge">队员</span>
                </div>
              </li>
            )}
          </ul>
        </div>
      </section>

      <section className="vp-section teams-danger-zone" aria-labelledby="team-danger-title">
        <h2 id="team-danger-title">危险区域</h2>
        <div className="settings-panel teams-danger-row">
          <p id="team-danger-impact">
            {owner
              ? "解散后，本队的比赛和打印件将永久删除。"
              : "退出后，你将失去对本队比赛和打印件的访问权限。"}
          </p>
          {owner ? (
            <DeleteGroup kind="team" id={teamId} onDeleted={onTeamChanged} />
          ) : (
            <Button
              variant="outline"
              className="settings-action teams-danger-action"
              aria-describedby="team-danger-impact"
              disabled={pending}
              onClick={() => setConfirmation({ kind: "leave" })}
            >
              退出队伍
            </Button>
          )}
        </div>
      </section>

      {error && <p className="vp-error" role="alert">{error}</p>}

      {owner && (
        <dialog
          ref={invitationDialog}
          className="vp-dialog teams-invite-dialog"
          aria-labelledby="team-invite-title"
          aria-describedby={confirmReset ? "invite-reset-impact" : undefined}
          onCancel={(event) => {
            if (pending) { event.preventDefault(); return; }
            if (confirmReset) {
              event.preventDefault();
              setConfirmReset(false);
            }
          }}
          onClose={() => { setConfirmReset(false); setError(""); }}
        >
          <header>
            <h2 id="team-invite-title">{confirmReset ? "重置邀请链接？" : "邀请队员"}</h2>
            {!confirmReset && (
              <button
                type="button"
                aria-label="关闭"
                className="invite-close"
                onClick={() => invitationDialog.current?.close()}
              >
                <X size={18} aria-hidden="true" />
              </button>
            )}
          </header>
          {error && <p className="vp-error" role="alert">{error}</p>}
          {confirmReset ? (
            <>
              <p id="invite-reset-impact">
                已发出的邀请链接会立即失效，尚未入队的人需要使用新链接。
              </p>
              <div className="vp-actions">
                <Button
                  variant="outline"
                  className="settings-action"
                  disabled={pending}
                  onClick={() => setConfirmReset(false)}
                >
                  取消
                </Button>
                <Button className="vp-danger" disabled={pending} onClick={() => void resetInvitation()}>
                  确认重置
                </Button>
              </div>
            </>
          ) : (
            <>
              <label className="vp-field">
                邀请链接
                <input readOnly value={invitationUrl} onFocus={(event) => event.target.select()} />
              </label>
              <p role="status">
                {inviteStatus === "reset"
                  ? "链接已重置，旧链接已失效。"
                  : inviteStatus === "copied"
                    ? "邀请链接已复制。"
                    : inviteStatus === "failed"
                      ? "复制失败，请选中链接后手动复制。"
                      : "同一条链接可邀请多人。"}
              </p>
              <div className="vp-actions">
                <Button
                  variant="outline"
                  className="settings-action"
                  disabled={inviteStatus === "copying"}
                  onClick={() => setConfirmReset(true)}
                >
                  <RotateCcw size={15} aria-hidden="true" />重置链接
                </Button>
                <Button
                  className="vp-primary"
                  disabled={inviteStatus === "copying" || !invitationUrl}
                  onClick={() => void copyInvitation()}
                >
                  {inviteStatus === "copied"
                    ? <Check size={15} aria-hidden="true" />
                    : <Copy size={15} aria-hidden="true" />}
                  {inviteStatus === "copied" ? "已复制" : "复制链接"}
                </Button>
              </div>
            </>
          )}
        </dialog>
      )}

      <dialog
        ref={confirmationDialog}
        onCancel={event => { if (pending) event.preventDefault(); }}
        className="vp-dialog"
        aria-labelledby="team-confirmation-title"
        onClose={() => {
          setConfirmation(null);
          setError("");
          if (
            document.activeElement === document.body ||
            confirmationDialog.current?.contains(document.activeElement)
          ) {
            membersHeading.current?.focus({ preventScroll: true });
          }
        }}
      >
        {confirmation && (
          <>
            <h2 id="team-confirmation-title">
              {confirmation.kind === "transfer"
                ? "转让队长"
                : confirmation.kind === "remove"
                  ? "移除队员"
                  : "退出队伍"}
            </h2>
            {error && <p className="vp-error" role="alert">{error}</p>}
            {confirmation.kind === "transfer" && (
              <p>
                将队长转让给「{confirmation.member.name}」。你成为队员，比赛和打印件保持不变。
              </p>
            )}
            {confirmation.kind === "remove" && (
              <p>
                移除「{confirmation.member.name}」，并重置邀请链接。对方将不能访问本队比赛。
              </p>
            )}
            {confirmation.kind === "leave" && <p>退出后，原邀请链接继续有效。</p>}
            <div className="vp-actions">
              <Button
                variant="outline"
                className="vp-secondary"
                autoFocus disabled={pending}
                onClick={() => setConfirmation(null)}
              >
                取消
              </Button>
              <Button
                className={confirmation.kind === "transfer" ? "vp-primary" : "vp-danger"}
                disabled={pending}
                onClick={() => void confirmAction()}
              >
                确认
              </Button>
            </div>
          </>
        )}
      </dialog>
    </div>
  );
}
