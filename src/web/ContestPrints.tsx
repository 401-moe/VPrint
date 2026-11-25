import { lazy, Suspense, useEffect, useRef, useState, type MouseEventHandler } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { LanguageIcon, languageForFilename } from "./LanguageIcon";

interface PrintRecord {
  id: string;
  filename: string;
  createdAt: number;
}

interface PrintDetail {
  filename: string;
  createdAt: number;
  content: string;
}

const SourceReader = lazy(() => import("./SourceReader").then(module => ({ default: module.SourceReader })));

const timestamp = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
const day = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" });

function isoTimestamp(value: number) {
  return new Date(value).toISOString();
}

function previewLines(source: string, count = 8) {
  return source.replace(/\r\n?/g, "\n").split("\n", count + 1).slice(0, count);
}

export function PrintList({
  contestId,
  contestName,
  createdAt,
  returnHref,
  version,
  navigate,
  returnState,
}: {
  contestId: string;
  contestName: string;
  createdAt: number;
  returnHref: string;
  version: number;
  navigate: MouseEventHandler<HTMLAnchorElement>;
  returnState?: { printId: string; scrollY: number } | null;
}) {
  const [records, setRecords] = useState<PrintRecord[] | null>(null);
  const [latestPreview, setLatestPreview] = useState<{ status: "loading" | "ready" | "failed"; content?: string }>({ status: "loading" });
  const [error, setError] = useState(false);
  const root = useRef<HTMLElement>(null);
  const [showLatestProof, setShowLatestProof] = useState(() => window.matchMedia("(min-width: 681px)").matches);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/contests/${contestId}/prints`, { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error();
        const data = await response.json() as { printouts: PrintRecord[] };
        setRecords(data.printouts);
        setError(false);
      })
      .catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [contestId, version]);
  useEffect(() => {
    const query = window.matchMedia("(min-width: 681px)");
    const change = () => setShowLatestProof(query.matches);
    query.addEventListener("change", change);
    return () => query.removeEventListener("change", change);
  }, []);
  useEffect(() => {
    const latest = records?.[0];
    const controller = new AbortController();
    if (latest && showLatestProof) {
      setLatestPreview(current => current.content === undefined ? current : { status: "loading" });
      fetch(`/api/contests/${contestId}/prints/${latest.id}`, { signal: controller.signal })
        .then(async response => {
          if (!response.ok) throw new Error();
          const detail = await response.json() as PrintDetail;
          setLatestPreview({ status: "ready", content: detail.content });
        })
        .catch(() => { if (!controller.signal.aborted) setLatestPreview({ status: "failed" }); });
    }
    return () => controller.abort();
  }, [contestId, records?.[0]?.id, showLatestProof]);
  const restore = useRef(Boolean(returnState));
  useEffect(() => {
    if (!restore.current || !returnState || !records?.length || !root.current) return;
    restore.current = false;
    window.scrollTo(0, returnState.scrollY);
    const link = Array.from(root.current.querySelectorAll<HTMLAnchorElement>(".ft-link"))
      .find(element => element.getAttribute("href") === `/contest/${contestId}/print/${returnState.printId}`);
    link?.focus({ preventScroll: true });
  }, [contestId, records?.length, returnState]);
  if (error) return <main className="files-shell" aria-label="打印件列表"><h1 className="files-error-heading">无法读取打印列表</h1><p role="alert">请稍后重试。</p></main>;
  if (!records) return <main className="files-shell" aria-busy="true" aria-label="打印件列表"><h1>正在读取打印件…</h1></main>;

  const latest = records[0];
  return (
    <main className="files-shell" ref={root}>
      <header className="files-title">
        <div>
          <h1>{contestName}</h1>
          <p><time dateTime={isoTimestamp(createdAt)}>{day.format(createdAt)}</time><span>·</span>{records.length} 份打印件</p>
        </div>
        <div className="contest-actions">
          <a className="back-file" href={returnHref}><ArrowLeft size={16} aria-hidden="true"/>返回工作台</a>
          <a className="settings-action" href="https://github.com/401-moe/VPrint/releases">安装 CLI</a>
        </div>
      </header>
      <div className="file-workspace">
        <section aria-label="打印件列表" className="file-table">
          <header className="ft-row ft-head"><span>文件名</span><span>类型</span><span>打印时间</span></header>
          {records.length ? <ul>
            {records.map(record => {
              const language = languageForFilename(record.filename);
              return <li key={record.id}>
                <a onClick={navigate} className="ft-row ft-link" href={`/contest/${contestId}/print/${record.id}`}>
                  <span className="filename"><LanguageIcon language={language} />{record.filename}</span>
                  <span className="ft-language">{language}</span>
                  <time dateTime={isoTimestamp(record.createdAt)}>{timestamp.format(record.createdAt)}</time>
                </a>
              </li>;
            })}
          </ul> : <p className="vp-note files-empty">还没有打印件。队员从 CLI 打印后，文件会出现在这里。</p>}
        </section>
        {showLatestProof && latest && <aside className="latest-proof" aria-label="最新打印件">
          <h2>最新打印件</h2>
          <div className="proof-sheet">
            <div className="proof-mast">
              <span>{languageForFilename(latest.filename)}</span>
              <time dateTime={isoTimestamp(latest.createdAt)}>{timestamp.format(latest.createdAt)}</time>
            </div>
            <h3>{latest.filename}</h3>
            {latestPreview.status === "ready" && latestPreview.content !== undefined ? (
              <div className="proof-code" aria-hidden="true">
                {previewLines(latestPreview.content).map((line, index) => <div key={index}><i>{index + 1}</i><code>{line || " "}</code></div>)}
              </div>
            ) : <p className="proof-status" role="status">{latestPreview.status === "failed" ? "暂时无法读取预览。" : "正在读取预览…"}</p>}
            <a className="open-proof" href={`/contest/${contestId}/print/${latest.id}`}>阅读全文<ArrowRight size={15} aria-hidden="true"/></a>
          </div>
        </aside>}
      </div>
    </main>
  );
}

export function PrintPage({
  contestId,
  contestName,
  createdAt,
  printId,
  noticeId,
  navigate,
}: {
  contestId: string;
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
    fetch(`/api/contests/${contestId}/prints/${printId}`, { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error();
        setDetail(await response.json() as PrintDetail);
        setError(false);
      })
      .catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [contestId, printId]);
  useEffect(() => {
    if (noticeId) toast("本场比赛有新打印件", { id: noticeId, duration: 3000 });
  }, [noticeId]);
  return (
    <main className="files-shell files-reading">
      <aside className="file-context">
        <a className="back-file" onClick={navigate} href={`/contest/${contestId}`}>
          <ArrowLeft size={16} aria-hidden="true" />返回列表
        </a>
        <h2>{contestName}</h2>
        <p><time dateTime={isoTimestamp(createdAt)}>{day.format(createdAt)}</time></p>
      </aside>
      <article className="file-manuscript" aria-label="打印件">
        {error && <div className="files-error" role="alert">无法读取这份打印件。</div>}
        {detail && <>
          <header>
            <div className="manuscript-title">
              <LanguageIcon language={languageForFilename(detail.filename)} />
              <h1>{detail.filename}</h1>
            </div>
            <p className="manuscript-facts">
              <span>{languageForFilename(detail.filename)}</span>
              <span>{detail.content.replace(/\r\n?/g, "\n").replace(/\n$/, "").split("\n").length} 行</span>
              <time dateTime={isoTimestamp(detail.createdAt)}>打印于 {timestamp.format(detail.createdAt)}</time>
            </p>
          </header>
          <Suspense fallback={<div className="source-scroll source-loading" role="status" aria-label="正在读取源码" />}>
            <SourceReader filename={detail.filename} source={detail.content} />
          </Suspense>
        </>}
      </article>
    </main>
  );
}
