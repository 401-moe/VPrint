import { useMemo } from "react";
import hljs from "highlight.js/lib/core";
import cpp from "highlight.js/lib/languages/cpp";
import python from "highlight.js/lib/languages/python";
import java from "highlight.js/lib/languages/java";
import kotlin from "highlight.js/lib/languages/kotlin";
import rust from "highlight.js/lib/languages/rust";
import go from "highlight.js/lib/languages/go";
import javascript from "highlight.js/lib/languages/javascript";
import "highlight.js/styles/github.css";
import "./source-reader.css";

for (const [name, language] of Object.entries({ cpp, python, java, kotlin, rust, go, javascript })) {
  hljs.registerLanguage(name, language);
}

const extensions: Record<string, string> = {
  c: "cpp", h: "cpp", cc: "cpp", cpp: "cpp", cxx: "cpp", hpp: "cpp",
  py: "python", java: "java", kt: "kotlin", kts: "kotlin", rs: "rust", go: "go", js: "javascript",
};

export function SourceReader({ filename, source }: { filename: string; source: string }) {
  const text = source.replace(/\r\n?/g, "\n");
  const extension = /\.([a-z0-9]+)$/i.exec(filename)?.[1].toLowerCase();
  const language = extension && Object.hasOwn(extensions, extension) ? extensions[extension] : undefined;
  const highlighted = useMemo(() => language ? hljs.highlight(text, { language }).value : null, [text, language]);
  const lines = useMemo(() => {
    const count = text.replace(/\n$/, "").split("\n").length;
    return Array.from({ length: count }, (_, index) => index + 1).join("\n");
  }, [text]);
  return <div className="source-scroll" role="region" aria-label="源码" tabIndex={0}>
    <div className="source-lines" aria-hidden="true" data-lines={lines} />
    <pre>{highlighted === null ? <code>{text}</code> : <code dangerouslySetInnerHTML={{ __html: highlighted }} />}</pre>
  </div>;
}
