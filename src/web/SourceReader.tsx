import { useMemo } from "react";
import hljs from "highlight.js/lib/core";
import cpp from "highlight.js/lib/languages/cpp";
import python from "highlight.js/lib/languages/python";
import java from "highlight.js/lib/languages/java";
import kotlin from "highlight.js/lib/languages/kotlin";
import rust from "highlight.js/lib/languages/rust";
import go from "highlight.js/lib/languages/go";
import javascript from "highlight.js/lib/languages/javascript";
import { grammarForFilename } from "./LanguageIcon";

for (const [name, language] of Object.entries({
  cpp,
  python,
  java,
  kotlin,
  rust,
  go,
  javascript,
})) {
  hljs.registerLanguage(name, language);
}

export function SourceReader({
  filename,
  source,
  className = "",
}: {
  filename: string;
  source: string;
  className?: string;
}) {
  const text = source.replace(/\r\n?/g, "\n");
  const language = grammarForFilename(filename) || undefined;
  const highlighted = useMemo(
    () => (language ? hljs.highlight(text, { language }).value : null),
    [text, language],
  );
  const lines = useMemo(() => {
    const count = text.replace(/\n$/, "").split("\n").length;
    return Array.from({ length: count }, (_, index) => index + 1).join("\n");
  }, [text]);

  return (
    <div
      className={`vp-source-scroll ${className}`}
      role="region"
      aria-label="源码"
      tabIndex={0}
    >
      <div className="vp-source-lines" aria-hidden="true" data-lines={lines} />
      <pre className="vp-source-pre">
        {highlighted === null ? (
          <code>{text}</code>
        ) : (
          <code dangerouslySetInnerHTML={{ __html: highlighted }} />
        )}
      </pre>
    </div>
  );
}
