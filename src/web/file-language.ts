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
  return extension && Object.hasOwn(languages, extension) ? languages[extension] : plainText;
}

export function languageForFilename(filename: string) {
  return language(filename).name;
}

export function grammarForFilename(filename: string) {
  return language(filename).grammar;
}
