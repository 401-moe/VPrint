export const maxPrintBytes = 65_536;

export function decodePrintText(bytes: Uint8Array) {
  if (bytes.byteLength > maxPrintBytes) throw new Error("单个文件最多 64 KiB。");
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new Error("仅支持 UTF-8 纯文本。");
  }
  // Permit tabs, line breaks and form feeds in source text.
  if (/[\u0000-\u0008\u000e-\u001f\u007f]/u.test(text)) throw new Error("仅支持 UTF-8 纯文本。");
  return text;
}
