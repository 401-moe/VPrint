import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { basename } from "node:path";
import { decodePrintText, maxPrintBytes } from "../../src/shared/print-text.ts";

export async function readPrintFile(path: string) {
  // A FIFO must reach the regular-file check without waiting for a writer.
  const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const metadata = await file.stat();
    if (!metadata.isFile()) throw new Error("请选择普通文件。");
    if (metadata.size > maxPrintBytes) throw new Error("单个文件最多 64 KiB。");
    const buffer = Buffer.alloc(maxPrintBytes + 1);
    let size = 0;
    while (size < buffer.length) {
      const { bytesRead } = await file.read(buffer, size, buffer.length - size, null);
      if (bytesRead === 0) break;
      size += bytesRead;
    }
    const bytes = buffer.subarray(0, size);
    decodePrintText(bytes);
    return { filename: basename(path), bytes, mtime: metadata.mtime };
  } finally {
    await file.close();
  }
}
