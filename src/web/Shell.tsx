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
      <div className="mx-auto flex h-12 max-w-[1160px] items-center justify-between gap-4 px-4 sm:px-6">
        <nav
          aria-label="页面层级导航"
          className="flex min-w-0 items-center gap-1.5 text-[13px]"
        >
          <a
            href="/"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-[var(--radius-control)] px-1.5 py-1 font-semibold text-[var(--text)] vp-hover-surface max-md:min-h-[44px]"
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
                className={`shrink-0 rounded-[var(--radius-control)] px-1.5 py-1 vp-hover-surface max-md:min-h-[44px] inline-flex items-center ${
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
                className={`max-w-[180px] sm:max-w-[260px] truncate rounded-[var(--radius-control)] px-1.5 py-1 vp-hover-surface max-md:min-h-[44px] inline-flex items-center ${
                  !contest
                    ? "font-medium text-[var(--text)]"
                    : "text-[var(--muted)] hover:text-[var(--text)]"
                }`}
              >
                {team.name}
              </a>
            </>
          )}

          {memberName && contest && (
            <>
              <span className="hidden sm:inline shrink-0 text-[var(--faint)]" aria-hidden="true">
                /
              </span>
              <a
                href={`/contest/${contest.id}`}
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
            className={`shrink-0 rounded-[var(--radius-control)] px-2 py-1 text-[13px] vp-hover-surface max-md:min-h-[44px] inline-flex items-center ${
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
