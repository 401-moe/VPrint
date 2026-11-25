import { type FormEvent, type ReactNode, useRef, useState } from "react";
import { Menu } from "@base-ui/react/menu";
import { Check, ChevronDown, FolderOpen, LogOut, Plus, Printer, UserRound, UsersRound } from "lucide-react";
import { Button } from "./components/ui/button";

export interface Team {
  id: string;
  name: string;
  role: string;
  invitationUrl: string;
}

export function Header({ children }: { children?: ReactNode }) {
  return <header className="app-bar"><div className="bar-inner">
    <a className="brand flex items-center gap-2" href="/">
      <span className="brand-mark"><Printer size={18} aria-hidden="true" /></span><strong>VPrint</strong>
    </a>{children}
  </div></header>;
}

export function TeamSwitcher({ teams, selected, pending, select, create }: {
  teams: Team[]; selected?: Team; pending: boolean; select: (id: string) => void; create: () => void;
}) {
  const openedDialog = useRef(false);
  return <><span className="bar-divider" aria-hidden="true" />
    <Menu.Root onOpenChange={open => { if (open) openedDialog.current = false; }}>
      <Menu.Trigger className="team-name vp-team-trigger" disabled={pending}
        aria-label={selected ? `切换队伍，当前为${selected.name}` : "选择队伍"}>
        <span>{selected?.name || "选择队伍"}</span><ChevronDown size={14} aria-hidden="true"/>
      </Menu.Trigger>
      <Menu.Portal><Menu.Positioner className="vp-menu-position" sideOffset={4} align="start">
        <Menu.Popup className="vp-menu vp-team-menu" aria-label="队伍" finalFocus={() => !openedDialog.current}>
          <Menu.RadioGroup value={selected?.id ?? ""} onValueChange={select}>
            {teams.map(team => <Menu.RadioItem className="vp-menu-item" value={team.id} key={team.id} closeOnClick>
              <span>{team.name}</span><Menu.RadioItemIndicator><Check size={15}/></Menu.RadioItemIndicator>
            </Menu.RadioItem>)}
          </Menu.RadioGroup>
          {teams.length > 0 && <Menu.Separator className="vp-rule"/>}
          <Menu.Item className="vp-menu-item" onClick={() => { openedDialog.current = true; create(); }}>
            <Plus size={15}/>新建队伍
          </Menu.Item>
        </Menu.Popup>
      </Menu.Positioner></Menu.Portal>
    </Menu.Root>
  </>;
}

export function CreateTeamDialog({ dialog, create }: {
  dialog: React.RefObject<HTMLDialogElement | null>; create: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || pending) return;
    setPending(true); setError("");
    try {
      await create(name.trim());
      dialog.current?.close();
    } catch { setError("创建队伍失败，请重试。"); }
    finally { setPending(false); }
  }
  return <dialog ref={dialog} className="vp-dialog vp-create-team" aria-labelledby="create-team-title"
    onCancel={event => { if (pending) event.preventDefault(); }}
    onClose={() => {
      setName(""); setError("");
      if (document.activeElement === document.body) document.querySelector<HTMLButtonElement>(".vp-team-trigger")?.focus();
    }}>
    <h2 id="create-team-title">新建队伍</h2>
    <form className="vp-form" onSubmit={submit}>
      <label className="vp-field">队伍名称<input required autoFocus maxLength={100} value={name} onChange={e => setName(e.target.value)} /></label>
      {error && <p className="vp-error" role="alert">{error}</p>}
      <div className="vp-actions">
        <Button type="button" variant="outline" className="vp-secondary" disabled={pending} onClick={() => dialog.current?.close()}>取消</Button>
        <Button type="submit" className="vp-primary" disabled={!name.trim() || pending}>创建队伍</Button>
      </div>
    </form>
  </dialog>;
}

const destinations = [
  { href: "/workspace", label: "比赛工作台", icon: FolderOpen },
  { href: "/team", label: "队伍设置", icon: UsersRound },
  { href: "/account", label: "账号设置", icon: UserRound },
];
export function Sidebar({ path, name, email, signOut, pending }: {
  path: string; name: string; email: string; signOut: () => void; pending: boolean;
}) {
  return <aside className="vp-sidebar">
    <nav aria-label="工作区导航">{destinations.map(({ href, label, icon: Icon }) =>
      <a href={href} aria-current={path === href ? "page" : undefined} key={href}><Icon size={17} aria-hidden="true"/>{label}</a>)}</nav>
    <div className="vp-user">
      <a className="vp-user-profile" href="/account" title={email}><span className="vp-avatar">{(name || email).slice(0,1)}</span>
        <span><strong>{name}</strong><small>{email}</small></span></a>
      <button aria-label="退出登录" title="退出登录" onClick={signOut} disabled={pending}><LogOut size={16}/></button>
    </div>
  </aside>;
}
