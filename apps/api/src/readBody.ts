import type { IncomingMessage } from "node:http";

/** 防止超大 JSON 拖垮进程；控制台 API 单请求体通常远小于此 */
const MAX_JSON_BODY_BYTES = 1_048_576; // 1 MiB

export async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    total += buf.length;
    if (total > MAX_JSON_BODY_BYTES) {
      throw new Error(`请求体超过 ${MAX_JSON_BODY_BYTES} 字节上限`);
    }
    chunks.push(buf);
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) {
    return {};
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new Error("请求体须为合法 JSON");
  }
}
