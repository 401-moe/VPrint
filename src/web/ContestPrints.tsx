import { type FormEvent, lazy, type MouseEventHandler, Suspense, useEffect, useRef, useState } from "react";
import { ArrowLeft, Copy, Settings, Terminal, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "./api";
import { languageForFilename } from "./file-language";
import { Button, buttonClassName } from "./ui/button";
import { DialogContent, DialogRoot } from "./ui/dialog";
import { Input } from "./ui/input";

interface PrintRecord {
  id: string;
  filename: string;
  createdAt: number;
  authorName?: string | null;
}

interface PrintDetail {
  filename: string;
  createdAt: number;
  content: string;
  authorName?: string | null;
}

interface ContestDeletePreview {
  name: string;
  printoutCount: number;
}

const SourceReader = lazy(() =>
  import("./SourceReader").then((module) => ({ default: module.SourceReader })),
);

const timestamp = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

const day = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function isoTimestamp(value: number) {
  return new Date(value).toISOString();
}

function computeDuplicateTags(records: PrintRecord[]): Map<string, number> {
  const totalsByFile = new Map<string, number>();
  for (const item of records) {
    totalsByFile.set(item.filename, (totalsByFile.get(item.filename) ?? 0) + 1);
  }
  const remainingByFile = new Map(totalsByFile);
  const tags = new Map<string, number>();
  for (const item of records) {
    const total = totalsByFile.get(item.filename) ?? 1;
    if (total > 1) {
      const currentNum = remainingByFile.get(item.filename) ?? 1;
      tags.set(item.id, currentNum);
      remainingByFile.set(item.filename, currentNum - 1);
    }
  }
  return tags;
}

export function PrintList({
  contestId,
  contestHref,
  contestName,
  createdAt,
  teamHref,
  version,
  navigate,
  returnState,
}: {
  contestId: string;
  contestHref: string;
  contestName: string;
  createdAt: number;
  teamHref: string;
  version: number;
  navigate: MouseEventHandler<HTMLAnchorElement>;
  returnState?: { printId: string; scrollY: number } | null;
}) {
  const [records, setRecords] = useState<PrintRecord[] | null>(null);
  const [error, setError] = useState(false);
  const root = useRef<HTMLElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/contests/${contestId}/prints`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        const data = (await response.json()) as { printouts: PrintRecord[] };
        setRecords(data.printouts);
        setError(false);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, [contestId, version]);

  const restore = useRef(Boolean(returnState));
  useEffect(() => {
    if (!restore.current || !returnState || !records?.length || !root.current)
      return;
    restore.current = false;
    window.scrollTo(0, returnState.scrollY);
    const link = Array.from(
      root.current.querySelectorAll<HTMLAnchorElement>(".ft-link"),
    ).find(
      (element) =>
        element.getAttribute("href") ===
        `${contestHref}/print/${returnState.printId}`,
    );
    link?.focus({ preventScroll: true });
  }, [contestHref, records?.length, returnState]);

  if (error) {
    return (
      <main
        className="mx-auto max-w-[960px] px-4 py-8 sm:px-6"
        aria-label="打印件列表"
      >
        <h1 className="text-[22px] font-semibold text-[var(--text)]">
          无法读取打印列表
        </h1>
        <p role="alert" className="mt-2 text-[13px] text-[var(--negative)]">
          请稍后重试。
        </p>
      </main>
    );
  }

  if (!records) {
    return (
      <main
        className="mx-auto max-w-[960px] px-4 py-8 sm:px-6"
        aria-busy="true"
        aria-label="打印件列表"
      >
        <p role="status" className="text-[13px] text-[var(--muted)]">
          正在读取打印件…
        </p>
      </main>
    );
  }

  const dupTags = computeDuplicateTags(records);

  return (
    <main className="mx-auto max-w-[960px] px-4 py-8 sm:px-6" ref={root}>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <a
            href={teamHref}
            className={buttonClassName({
              variant: "ghost",
              compact: true,
              className: "-ml-2 mb-1",
            })}
          >
            <ArrowLeft size={14} aria-hidden="true" />
            <span>返回比赛列表</span>
          </a>
          <h1 className="text-[22px] sm:text-[24px] font-semibold tracking-[-0.02em] leading-[1.25] text-[var(--text)]">
            打印列表
          </h1>
          <p className="mt-1 text-[13px] text-[var(--muted)] vp-num">
            {contestName} ·{" "}
            <time dateTime={isoTimestamp(createdAt)}>
              {day.format(createdAt)}
            </time>{" "}
            · {records.length} 份打印件
          </p>
        </div>

        <a
          href={`${contestHref}/settings`}
          onClick={navigate}
          className={buttonClassName({ variant: "secondary" })}
        >
          <Settings size={14} aria-hidden="true" />
          <span>比赛设置</span>
        </a>
      </div>

      <section
        aria-label="打印件列表"
        className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] overflow-hidden"
      >
        {records.length === 0 ? (
          <div className="px-6 py-12 text-center space-y-3">
            <p className="text-[14px] text-[var(--muted)]">
              还没有打印件。队员从 CLI 打印后，文件会出现在这里。
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <code className="inline-flex items-center rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--ground)] px-3 py-1.5 text-[12px] text-[var(--text)]">
                $ vprint A.cpp
              </code>
              <a
                className={buttonClassName({ variant: "secondary", compact: true })}
                href="https://github.com/vprint-ac/VPrint/releases"
              >
                安装 CLI
              </a>
            </div>
          </div>
        ) : (
          <ul aria-label="打印件" className="divide-y divide-[var(--rule)]">
            {records.map((record) => {
              const language = languageForFilename(record.filename);
              const runNumber = dupTags.get(record.id);
              return (
                <li key={record.id}>
                  <a
                    onClick={navigate}
                    className="ft-link flex w-full items-center justify-between gap-4 px-5 py-3 vp-hover-row min-h-[46px] max-md:min-h-[48px]"
                    href={`${contestHref}/print/${record.id}`}
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <time
                        dateTime={isoTimestamp(record.createdAt)}
                        className="shrink-0 text-[12px] text-[var(--faint)] vp-num"
                      >
                        {timestamp.format(record.createdAt)}
                      </time>
                      <span className="vp-code-name truncate text-[14px] font-medium text-[var(--text)]">
                        {record.filename}
                      </span>
                      {runNumber !== undefined && (
                        <span className="shrink-0 rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--raised)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--muted)] vp-num">
                          第 {runNumber} 次打印
                        </span>
                      )}
                    </span>

                    <span className="flex shrink-0 items-center gap-3 text-[12px] text-[var(--muted)] vp-num">
                      {record.authorName && (
                        <span className="hidden md:inline">
                          {record.authorName}
                        </span>
                      )}
                      <span>{language}</span>
                    </span>
                  </a>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}

export function ContestSettings({
  contestId,
  contestHref,
  contestName,
  teamId,
  teamName,
  owner,
  navigate,
  onUpdated,
  onDeleted,
}: {
  contestId: string;
  contestHref: string;
  contestName: string;
  teamId: string;
  teamName: string;
  owner: boolean;
  navigate: MouseEventHandler<HTMLAnchorElement>;
  onUpdated: () => void;
  onDeleted: () => void;
}) {
  const [nameDraft, setNameDraft] = useState(contestName);
  const [saving, setSaving] = useState(false);
  const [deletePreview, setDeletePreview] =
    useState<ContestDeletePreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setNameDraft(contestName);
  }, [contestId, contestName]);

  const cliCommand = `vprint use --team ${teamId} --contest ${contestId}`;

  async function saveContestName(event: FormEvent) {
    event.preventDefault();
    const trimmed = nameDraft.trim();
    if (!trimmed || trimmed === contestName || saving) return;
    setSaving(true);
    setError("");
    try {
      await api(`/api/contests/${contestId}`, {
        method: "PATCH",
        body: JSON.stringify({ name: trimmed }),
      });
      toast.success(`已保存比赛名称「${trimmed}」`);
      onUpdated();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存比赛名称失败。");
    } finally {
      setSaving(false);
    }
  }

  async function copyCliCommand() {
    try {
      await navigator.clipboard.writeText(cliCommand);
      toast.success("已复制 CLI 绑定命令");
    } catch {
      toast.error("复制失败，请手动选中命令复制");
    }
  }

  async function openDeleteDialog() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      setDeletePreview(
        await api<ContestDeletePreview>(`/api/contests/${contestId}/deletion`),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法读取删除范围。");
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await api(`/api/contests/${contestId}/deletion`, { method: "DELETE" });
      setDeletePreview(null);
      toast(`已删除比赛「${contestName}」`);
      onDeleted();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "删除失败，请重新确认权限。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-[760px] px-4 py-8 sm:px-6 space-y-6">
      <div>
        <a
          href={contestHref}
          onClick={navigate}
          className={buttonClassName({
            variant: "ghost",
            compact: true,
            className: "-ml-2 mb-1",
          })}
        >
          <ArrowLeft size={14} aria-hidden="true" />
          <span>返回打印列表</span>
        </a>
        <h1 className="text-[22px] sm:text-[24px] font-semibold tracking-[-0.02em] leading-[1.25] text-[var(--text)]">
          比赛设置
        </h1>
        <p className="mt-1 text-[13px] text-[var(--muted)]">
          {teamName} · {contestName}
        </p>
      </div>

      <section className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-5">
        <h2 className="text-[14px] font-semibold text-[var(--text)]">比赛名称</h2>
        <form
          onSubmit={saveContestName}
          className="mt-3 flex flex-wrap items-center gap-2.5"
        >
          <label htmlFor="contest-name-field" className="sr-only">
            比赛名称
          </label>
          <Input
            id="contest-name-field"
            name="contest_title"
            maxLength={100}
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            className="flex-1 min-w-[200px]"
          />
          <Button
            type="submit"
            variant="primary"
            disabled={
              saving || !nameDraft.trim() || nameDraft.trim() === contestName
            }
          >
            {saving ? "保存中…" : "保存名称"}
          </Button>
        </form>
      </section>

      <section className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-[14px] font-semibold text-[var(--text)]">
              CLI 目录绑定
            </h2>
            <p className="mt-1 text-[13px] text-[var(--muted)]">
              在训练目录执行一次，即可把该目录与子目录绑定到本场比赛。
            </p>
          </div>
          <a
            className={buttonClassName({ variant: "ghost", compact: true })}
            href="https://github.com/vprint-ac/VPrint/releases"
          >
            安装 CLI
          </a>
        </div>
        <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--ground)] px-3 py-2">
          <Terminal
            size={14}
            className="shrink-0 text-[var(--muted)]"
            aria-hidden="true"
          />
          <code className="min-w-0 flex-1 break-words text-[13px] text-[var(--text)]">
            {cliCommand}
          </code>
          <Button
            variant="secondary"
            compact
            onClick={() => void copyCliCommand()}
          >
            <Copy size={13} aria-hidden="true" />
            <span>复制命令</span>
          </Button>
        </div>
      </section>

      {owner && (
        <section className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-[14px] font-semibold text-[var(--text)]">
                删除比赛
              </h2>
              <p className="mt-1 text-[13px] text-[var(--muted)]">
                仅队长可执行删除，比赛及其中全部打印件将永久清除。
              </p>
            </div>
            <Button
              variant="danger"
              disabled={busy}
              onClick={() => void openDeleteDialog()}
            >
              <Trash2 size={14} aria-hidden="true" />
              <span>删除比赛</span>
            </Button>
          </div>
        </section>
      )}

      {error && !deletePreview && (
        <p className="text-[13px] text-[var(--negative)]" role="alert">
          {error}
        </p>
      )}

      <DialogRoot
        open={deletePreview !== null}
        onOpenChange={(next) => {
          if (busy && !next) return;
          if (!next) {
            setDeletePreview(null);
            setError("");
          }
        }}
      >
        {deletePreview && (
          <DialogContent title="删除比赛" dismissible={!busy}>
            <div className="space-y-4">
              <div className="space-y-2 text-[13px] leading-6 text-[var(--muted)]">
                <p className="font-medium text-[var(--text)]">
                  {deletePreview.name}
                </p>
                <p className="vp-num">
                  {deletePreview.printoutCount} 份打印件将随比赛永久删除。
                </p>
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
                  onClick={() => setDeletePreview(null)}
                >
                  取消
                </Button>
                <Button
                  variant="danger"
                  disabled={busy}
                  onClick={() => void confirmDelete()}
                >
                  确认删除
                </Button>
              </div>
            </div>
          </DialogContent>
        )}
      </DialogRoot>
    </main>
  );
}

export function PrintPage({
  contestId,
  contestHref,
  contestName,
  createdAt,
  printId,
  noticeId,
  navigate,
}: {
  contestId: string;
  contestHref: string;
  contestName: string;
  createdAt: number;
  printId: string;
  noticeId: string;
  navigate: MouseEventHandler<HTMLAnchorElement>;
}) {
  const [detail, setDetail] = useState<PrintDetail | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/contests/${contestId}/prints/${printId}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        setDetail((await response.json()) as PrintDetail);
        setError(false);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, [contestId, printId]);

  useEffect(() => {
    if (noticeId) toast("本场比赛有新打印件", { id: noticeId, duration: 3000 });
  }, [noticeId]);

  const lineCount = detail
    ? detail.content.replace(/\r\n?/g, "\n").replace(/\n$/, "").split("\n").length
    : 0;
  const language = detail ? languageForFilename(detail.filename) : "";

  return (
    <main className="mx-auto max-w-[1160px] px-4 py-6 sm:px-6">
      <div className="mb-4">
        <a
          className={buttonClassName({
            variant: "ghost",
            compact: true,
            className: "-ml-2 mb-1",
          })}
          onClick={navigate}
          href={contestHref}
        >
          <ArrowLeft size={14} aria-hidden="true" />
          <span>返回打印列表</span>
        </a>

        {error && (
          <div
            className="mt-4 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-6 text-[13px] text-[var(--negative)]"
            role="alert"
          >
            无法读取这份打印件。
          </div>
        )}

        {detail && (
          <article aria-label="打印件">
            <header className="mb-4">
              <h1 className="vp-code-name text-[20px] sm:text-[22px] font-semibold tracking-[-0.02em] leading-[1.25] text-[var(--text)] break-all">
                {detail.filename}
              </h1>
              <p className="mt-1 flex flex-wrap items-center gap-2 text-[13px] text-[var(--muted)] vp-num">
                <span>{contestName}</span>
                <span aria-hidden="true">·</span>
                <span>{language}</span>
                <span aria-hidden="true">·</span>
                <span>{lineCount} 行</span>
                <span aria-hidden="true">·</span>
                <time dateTime={isoTimestamp(detail.createdAt)}>
                  打印于 {timestamp.format(detail.createdAt)}
                </time>
                {detail.authorName && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>{detail.authorName}</span>
                  </>
                )}
                <span className="hidden" aria-hidden="true">
                  {day.format(createdAt)}
                </span>
              </p>
            </header>

            <div className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
              <Suspense
                fallback={
                  <div
                    className="px-5 py-8 text-[13px] text-[var(--muted)]"
                    role="status"
                    aria-label="正在读取源码"
                  >
                    正在读取源码…
                  </div>
                }
              >
                <SourceReader
                  filename={detail.filename}
                  source={detail.content}
                />
              </Suspense>
            </div>
          </article>
        )}
      </div>
    </main>
  );
}
