import { useEffect, useState } from "react";

import { usePrintNotifications } from "./use-print-notifications";
import { SourceReader } from "./SourceReader";

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

export function PrintList({ contestId }: { contestId: string }) {
  const [records, setRecords] = useState<PrintRecord[] | null>(null);
  const [error, setError] = useState(false);
  const [version, setVersion] = useState(0);
  usePrintNotifications(contestId, false, notice => {
    if (notice.type === "reload") setVersion(value => value + 1);
  });
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/contests/${contestId}/prints`, { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error();
        const data = await response.json() as { printouts: PrintRecord[] };
        setRecords(data.printouts);
      })
      .catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [contestId, version]);
  if (error) return <p role="alert">无法读取打印列表。</p>;
  if (!records) return <p aria-busy="true">正在读取打印件…</p>;
  if (!records.length) return <p>还没有打印件。</p>;
  return (
    <ul className="contest-list" aria-label="打印件">
      {records.map(record => (
        <li key={record.id}>
          <a href={`/contest/${contestId}/print/${record.id}`}>{record.filename}</a>
          <time dateTime={new Date(record.createdAt).toISOString()}>{new Date(record.createdAt).toLocaleString("zh-CN")}</time>
        </li>
      ))}
    </ul>
  );
}

export function PrintPage({ contestId, printId }: { contestId: string; printId: string }) {
  const [detail, setDetail] = useState<PrintDetail | null>(null);
  const [error, setError] = useState(false);
  const [noticeId, setNoticeId] = useState("");
  usePrintNotifications(contestId, true, notice => {
    if (notice.type === "toast" && notice.id) setNoticeId(notice.id);
  });
  useEffect(() => {
    if (!noticeId) return;
    const timeout = setTimeout(() => setNoticeId(""), 3500);
    return () => clearTimeout(timeout);
  }, [noticeId]);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/contests/${contestId}/prints/${printId}`, { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error();
        setDetail(await response.json() as PrintDetail);
      })
      .catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [contestId, printId]);
  return (
    <article className="workspace-card print-page">
      <a href={`/contest/${contestId}`}>返回列表</a>
      {noticeId && <p className="print-toast" role="status">本场比赛有新打印件</p>}
      {error && <p role="alert">无法读取这份打印件。</p>}
      {detail && <>
        <h1 className="title">{detail.filename}</h1>
        <time dateTime={new Date(detail.createdAt).toISOString()}>{new Date(detail.createdAt).toLocaleString("zh-CN")}</time>
        <SourceReader filename={detail.filename} source={detail.content} />
      </>}
    </article>
  );
}
