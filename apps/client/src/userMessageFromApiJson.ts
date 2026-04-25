/**
 * 与 Web `messageFromApiErrorBody` 同序（`error` → `message` → `msg` → `description` / `reason` / `code`；再 `detail` 字符串），
 * 供壳内 fetch 解析 4xx/5xx JSON，避免只认 `error` 时漏掉常见字段。
 */
function pickStr(x: unknown): string | null {
  if (typeof x === "string" && x.trim().length > 0) {
    return x.trim();
  }
  if (typeof x === "number" && Number.isFinite(x)) {
    return String(x);
  }
  return null;
}

export function userMessageFromApiJson(
  j: Record<string, unknown> | null | undefined,
  httpStatus: number,
): string {
  if (j) {
    const a = pickStr(j.error);
    if (a) {
      return a;
    }
    const b = pickStr(j.message);
    if (b) {
      return b;
    }
    const c = pickStr(j.msg);
    if (c) {
      return c;
    }
    const d = pickStr(j.description);
    if (d) {
      return d;
    }
    const e = pickStr(j.reason);
    if (e) {
      return e;
    }
    const f = pickStr(j.code);
    if (f) {
      return f;
    }
  }
  const detail = j?.detail;
  if (typeof detail === "string" && detail.trim().length > 0) {
    return detail.trim();
  }
  return `HTTP ${httpStatus}`;
}
