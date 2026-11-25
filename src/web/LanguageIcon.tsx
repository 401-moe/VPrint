const glyphs = new Map([
  ["C", <path key="c" d="M18 6.5a7.5 7.5 0 1 0 0 11" />],
  ["C++", <path key="cpp" d="M11 6.5a6.5 6.5 0 1 0 0 11 M11 12h4m-2-2v4 M18 12h4m-2-2v4" />],
  ["Python", <>
    <path key="python-one" d="M7 7V5.5A2.5 2.5 0 0 1 9.5 3h4A2.5 2.5 0 0 1 16 5.5v4a2.5 2.5 0 0 1-2.5 2.5h-4A2.5 2.5 0 0 0 7 14.5V17H5a2 2 0 0 1-2-2v-5a3 3 0 0 1 3-3h5" />
    <path key="python-two" d="M7 7V5.5A2.5 2.5 0 0 1 9.5 3h4A2.5 2.5 0 0 1 16 5.5v4a2.5 2.5 0 0 1-2.5 2.5h-4A2.5 2.5 0 0 0 7 14.5V17H5a2 2 0 0 1-2-2v-5a3 3 0 0 1 3-3h5" transform="rotate(180 12 12)" />
  </>],
  ["Go", <path key="go" d="M2 8h8M4 12h4M2 16h5 M20 8a5.5 5.5 0 1 0 1 4h-5" />],
  ["Java", <path key="java" d="M6 10h11v4a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5z M17 10h1a3 3 0 0 1 0 6h-1 M5 21h14 M11 7c-3-2 3-3 1-6" />],
  ["JavaScript", <path key="javascript" d="M9 5H7a2 2 0 0 0-2 2v3l-2 2 2 2v3a2 2 0 0 0 2 2h2 M15 5h2a2 2 0 0 1 2 2v3l2 2-2 2v3a2 2 0 0 1-2 2h-2" />],
  ["Kotlin", <path key="kotlin" d="M4 4h16l-8 8 8 8H4z M4 12l8-8" />],
  ["Rust", <>
    <circle key="rust-circle" cx="12" cy="12" r="6.5" />
    <path key="rust-rays" d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8m9.2 9.2 1.8 1.8m0-12.8-1.8 1.8m-9.2 9.2-1.8 1.8" />
  </>],
  ["纯文本", <path key="plain" d="M5 3h9l5 5v13H5z M14 3v5h5 M8.5 12h7M8.5 16h7" />],
]);

const languages: Record<string, { name: string; grammar: string }> = {
  c: { name: "C", grammar: "cpp" },
  cc: { name: "C++", grammar: "cpp" },
  cpp: { name: "C++", grammar: "cpp" },
  cxx: { name: "C++", grammar: "cpp" },
  h: { name: "C++", grammar: "cpp" },
  hpp: { name: "C++", grammar: "cpp" },
  py: { name: "Python", grammar: "python" },
  java: { name: "Java", grammar: "java" },
  kt: { name: "Kotlin", grammar: "kotlin" },
  kts: { name: "Kotlin", grammar: "kotlin" },
  rs: { name: "Rust", grammar: "rust" },
  go: { name: "Go", grammar: "go" },
  js: { name: "JavaScript", grammar: "javascript" },
};

const plainText = { name: "纯文本", grammar: "" };

function language(filename: string) {
  const extension = /\.([a-z0-9]+)$/i.exec(filename)?.[1].toLowerCase();
  return extension ? languages[extension] ?? plainText : plainText;
}

export function languageForFilename(filename: string) {
  return language(filename).name;
}

export function grammarForFilename(filename: string) {
  return language(filename).grammar;
}

export function LanguageIcon({ language: name }: { language: string }) {
  return (
    <svg className="file-language-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {glyphs.get(name) ?? <path d="m8 7-5 5 5 5m8-10 5 5-5 5m-3-14-2 18" />}
    </svg>
  );
}
