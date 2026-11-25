import { useEffect, useRef, useState } from "react";
import { Menu } from "@base-ui/react/menu";
import { Ellipsis, Trash2 } from "lucide-react";
import { api } from "./api";
import { Button } from "./components/ui/button";

interface Summary {
  name: string;
  contestCount?: number;
  printoutCount: number;
}

type DeleteGroupProps = { id: string; onDeleted: () => void } & (
  { kind: "team" } | { kind: "contest"; name: string }
);

export function DeleteGroup(props: DeleteGroupProps) {
  const team = props.kind === "team";
  const target = team ? "解散队伍" : "删除比赛";
  const endpoint = `/api/${team ? "teams" : "contests"}/${props.id}/deletion`;
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function preview() {
    setPending(true);
    setError("");
    try {
      setSummary(await api<Summary>(endpoint));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法读取删除范围。");
    } finally {
      setPending(false);
    }
  }

  async function confirm() {
    setPending(true);
    setError("");
    try {
      await api(endpoint, { method: "DELETE" });
      setSummary(null);
      props.onDeleted();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "操作失败，请重新确认权限。");
    } finally {
      setPending(false);
    }
  }

  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const openingDialog = useRef(false);

  useEffect(() => {
    if (summary) dialog.current?.showModal();
    else dialog.current?.close();
  }, [summary]);

  return (
    <div>
      {props.kind === "team" ? (
        <Button ref={trigger} variant="outline" className="settings-action teams-danger-action"
          type="button" onClick={() => void preview()} disabled={pending}>
          {target}
        </Button>
      ) : (
        <Menu.Root onOpenChange={(open) => {
          if (open) openingDialog.current = false;
        }}>
          <Menu.Trigger
            ref={trigger}
            className="contest-options"
            aria-label={`管理比赛 ${props.name}`}
            disabled={pending}
          >
            <Ellipsis size={18} aria-hidden="true" />
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Positioner className="vp-menu-position" align="end" sideOffset={4}>
              <Menu.Popup className="vp-menu" finalFocus={() => !openingDialog.current}>
                <Menu.Item
                  className="vp-menu-item destructive-item"
                  onClick={() => {
                    openingDialog.current = true;
                    void preview();
                  }}
                >
                  <Trash2 size={15} aria-hidden="true" />删除比赛
                </Menu.Item>
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>
      )}
      {error && !summary && <p className="vp-error" role="alert">{error}</p>}
      <dialog
        ref={dialog} aria-label={target} className="vp-dialog"
        onCancel={event => { if (pending) event.preventDefault(); }}
        onClose={() => {
          setSummary(null);
          if (document.activeElement === document.body) trigger.current?.focus();
        }}
      >
        {summary && (
          <>
            <h2>{target}</h2>
            <p className="teams-dialog-target">{summary.name}</p>
            <p>
              {summary.contestCount !== undefined && `${summary.contestCount} 场比赛、`}
              {summary.printoutCount} 份打印件{team ? "将永久删除。" : "将随比赛永久删除。"}
            </p>
            {error && <p role="alert">{error}</p>}
            <div className="vp-actions">
              <Button variant="outline" className="vp-secondary" onClick={() => setSummary(null)} disabled={pending}>
                取消
              </Button>
              <Button className="vp-danger" onClick={() => void confirm()} disabled={pending}>
                {team ? "确认解散队伍" : "确认删除"}
              </Button>
            </div>
          </>
        )}
      </dialog>
    </div>
  );
}
