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

function useDeletion(endpoint: string, onDeleted: () => void) {
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
      onDeleted();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "操作失败，请重新确认权限。");
    } finally {
      setPending(false);
    }
  }

  return { summary, setSummary, error, pending, preview, confirm };
}

export function DeleteGroup({ kind, id, onDeleted }: {
  kind: "team" | "contest";
  id: string;
  onDeleted: () => void;
}) {
  const target = kind === "team" ? "解散队伍" : "删除比赛";
  const endpoint = `/api/${kind === "team" ? "teams" : "contests"}/${id}/deletion`;
  const { summary, setSummary, error, pending, preview, confirm } = useDeletion(endpoint, onDeleted);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (summary) dialog.current?.showModal();
    else dialog.current?.close();
  }, [summary]);

  return (
    <div>
      <Button
        variant="outline"
        className="settings-action teams-danger-action"
        type="button"
        onClick={() => void preview()}
        disabled={pending}
      >
        {target}
      </Button>
      {error && !summary && <p className="vp-error" role="alert">{error}</p>}
      <dialog ref={dialog} className="vp-dialog" aria-label={target} onClose={() => setSummary(null)} onCancel={event => { if (pending) event.preventDefault(); }}>
        {summary && (
          <>
            <h2>{target}</h2>
            <p className="teams-dialog-target">{summary.name}</p>
            <p>
              {summary.contestCount !== undefined && `${summary.contestCount} 场比赛、`}
              {summary.printoutCount} 份打印件将永久删除。
            </p>
            {error && <p role="alert">{error}</p>}
            <div className="vp-actions">
              <Button variant="outline" className="vp-secondary" onClick={() => setSummary(null)} disabled={pending}>
                取消
              </Button>
              <Button className="vp-danger" onClick={() => void confirm()} disabled={pending}>
                确认{target}
              </Button>
            </div>
          </>
        )}
      </dialog>
    </div>
  );
}

export function ContestActions({ id, name, onDeleted }: {
  id: string;
  name: string;
  onDeleted: () => void;
}) {
  const endpoint = `/api/contests/${id}/deletion`;
  const { summary, setSummary, error, pending, preview, confirm } = useDeletion(endpoint, onDeleted);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const openingDialog = useRef(false);

  useEffect(() => {
    if (summary) dialog.current?.showModal();
    else dialog.current?.close();
  }, [summary]);

  return (
    <div>
      <Menu.Root onOpenChange={(open) => {
        if (open) openingDialog.current = false;
      }}>
        <Menu.Trigger
          ref={trigger}
          className="contest-options"
          aria-label={`管理比赛 ${name}`}
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
      {error && !summary && <p className="vp-error" role="alert">{error}</p>}
      <dialog
        ref={dialog} aria-label="删除比赛" className="vp-dialog"
        onCancel={event => { if (pending) event.preventDefault(); }}
        onClose={() => {
          setSummary(null);
          if (document.activeElement === document.body) trigger.current?.focus();
        }}
      >
        {summary && (
          <>
            <h2>删除比赛</h2>
            <p className="teams-dialog-target">{name}</p>
            <p>{summary.printoutCount} 份打印件将随比赛永久删除。</p>
            {error && <p role="alert">{error}</p>}
            <div className="vp-actions">
              <Button variant="outline" className="vp-secondary" onClick={() => setSummary(null)} disabled={pending}>
                取消
              </Button>
              <Button className="vp-danger" onClick={() => void confirm()} disabled={pending}>
                确认删除
              </Button>
            </div>
          </>
        )}
      </dialog>
    </div>
  );
}
