import { contestPath } from "./workspace-routes";
import { Printer } from "lucide-react";

export interface Team {
  id: string;
  name: string;
  role: string;
  invitationUrl: string;
  memberCount?: number;
  contestCount?: number;
}

export function BreadcrumbHeader({
  memberName,
  team,
  contest,
  accountActive = false,
}: {
  memberName?: string;
  team?: { id: string; name: string } | null;
  contest?: { id: string; name: string } | null;
  accountActive?: boolean;
}) {
  return (
    <header className="border-b border-[var(--border)] bg-[var(--surface)]">
      <div className="vp-frame flex h-12 items-center justify-between gap-4">
        <nav
          aria-label="页面层级导航"
          className="flex min-w-0 items-center gap-1.5 text-[13px]"
        >
          <a
            href="/"
            className="-ml-1.5 inline-flex shrink-0 items-center gap-1.5 rounded-[var(--radius-control)] px-1.5 py-1 font-semibold text-[var(--text)] vp-hover-surface pointer-coarse:min-h-11"
          >
            <Printer size={15} className="text-[var(--muted)]" aria-hidden="true" />
            <span>VPrint</span>
          </a>

          {memberName && (
            <>
              <span className="text-[var(--faint)]" aria-hidden="true">
                /
              </span>
              <a
                href="/workspace"
                className={`shrink-0 rounded-[var(--radius-control)] px-1.5 py-1 vp-hover-surface pointer-coarse:min-h-11 inline-flex items-center ${
                  !team && !contest && !accountActive
                    ? "font-medium text-[var(--text)]"
                    : "text-[var(--muted)] hover:text-[var(--text)]"
                }`}
              >
                所有队伍
              </a>
            </>
          )}

          {memberName && team && (
            <>
              <span className="shrink-0 text-[var(--faint)]" aria-hidden="true">
                /
              </span>
              <a
                href={`/team/${team.id}`}
                className={`max-w-[min(40vw,260px)] truncate rounded-[var(--radius-control)] px-1.5 py-1 vp-hover-surface pointer-coarse:min-h-11 inline-flex items-center ${
                  !contest
                    ? "font-medium text-[var(--text)]"
                    : "text-[var(--muted)] hover:text-[var(--text)]"
                }`}
              >
                {team.name}
              </a>
            </>
          )}

          {memberName && team && contest && (
            <>
              <span className="hidden sm:inline shrink-0 text-[var(--faint)]" aria-hidden="true">
                /
              </span>
              <a
                href={contestPath(team.id, contest.id)}
                className="hidden sm:inline-flex max-w-[260px] truncate rounded-[var(--radius-control)] px-1.5 py-1 font-medium text-[var(--text)] vp-hover-surface"
              >
                {contest.name}
              </a>
            </>
          )}
        </nav>

        {memberName && (
          <a
            href="/account"
            className={`shrink-0 rounded-[var(--radius-control)] px-2 py-1 text-[13px] vp-hover-surface pointer-coarse:min-h-11 inline-flex items-center ${
              accountActive
                ? "font-medium text-[var(--text)]"
                : "text-[var(--muted)] hover:text-[var(--text)]"
            }`}
          >
            {memberName}
          </a>
        )}
      </div>
    </header>
  );
}
