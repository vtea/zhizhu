/** 解析 API JSON 错误体（与 apps/api `sendJson` 的 `{ error }` 一致，并兼容 `message` / `detail` 及常见校验结构） */
export function tryParseApiErrorJson(raw: string): {
  error?: unknown;
  message?: unknown;
  detail?: unknown;
} | null {
  try {
    const j: unknown = JSON.parse(raw) as unknown;
    if (j === null || typeof j !== "object") {
      return null;
    }
    if (Array.isArray(j)) {
      return null;
    }
    return j as { error?: unknown; message?: unknown; detail?: unknown };
  } catch {
    return null;
  }
}

/** FastAPI 等常把 `detail` 做成 `{ loc, msg }[]`；尽量拼成一句可读中文分号句。 */
function textFromDetail(detail: unknown): string | undefined {
  if (typeof detail === "string" && detail.trim().length > 0) {
    return detail.trim();
  }
  if (Array.isArray(detail) && detail.length > 0) {
    const parts: string[] = [];
    for (const item of detail) {
      if (typeof item === "string" && item.trim().length > 0) {
        parts.push(item.trim());
        continue;
      }
      if (item && typeof item === "object" && "msg" in item) {
        const msg = (item as { msg?: unknown }).msg;
        if (typeof msg === "string" && msg.trim().length > 0) {
          const loc = (item as { loc?: unknown }).loc;
          if (Array.isArray(loc) && loc.length > 0) {
            const path = loc.map((x) => String(x)).join(".");
            parts.push(`${path}：${msg.trim()}`);
          } else {
            parts.push(msg.trim());
          }
          continue;
        }
      }
      if (item && typeof item === "object" && "type" in item) {
        const typ = (item as { type?: unknown }).type;
        if (typeof typ === "string" && typ.trim().length > 0) {
          const loc = (item as { loc?: unknown }).loc;
          if (Array.isArray(loc) && loc.length > 0) {
            const path = loc.map((x) => String(x)).join(".");
            parts.push(`${path}：${typ.trim()}`);
          } else {
            parts.push(typ.trim());
          }
        }
      }
    }
    if (parts.length > 0) {
      return parts.slice(0, 4).join("；") + (parts.length > 4 ? "…" : "");
    }
    try {
      const s = JSON.stringify(detail);
      return s.length > 240 ? `${s.slice(0, 240)}…` : s;
    } catch {
      return undefined;
    }
  }
  if (detail !== null && typeof detail === "object" && !Array.isArray(detail)) {
    if (
      "message" in detail &&
      typeof (detail as { message?: unknown }).message === "string" &&
      (detail as { message: string }).message.trim().length > 0
    ) {
      return (detail as { message: string }).message.trim();
    }
    try {
      const s = JSON.stringify(detail);
      return s.length > 240 ? `${s.slice(0, 240)}…` : s;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/**
 * `error` 可能为嵌套对象（如 `{ "message": "…" }` 或 `{ "error": { "message": "…" } }`）；
 * 部分网关会返回数字型 code，一并转成可读串。
 */
function textFromErrorField(err: unknown, depth = 0): string | undefined {
  if (depth > 2) {
    return undefined;
  }
  if (typeof err === "string" && err.trim().length > 0) {
    return err.trim();
  }
  if (typeof err === "number" && Number.isFinite(err)) {
    return String(err);
  }
  if (Array.isArray(err) && err.length > 0) {
    return textFromErrorField(err[0], depth + 1);
  }
  if (err && typeof err === "object" && !Array.isArray(err)) {
    const o = err as Record<string, unknown>;
    for (const k of ["message", "error", "msg", "detail", "code", "status"] as const) {
      const v = o[k];
      if (typeof v === "string" && v.trim().length > 0) {
        return v.trim();
      }
      if (typeof v === "number" && Number.isFinite(v)) {
        return String(v);
      }
      if (k === "detail" && v != null) {
        const d = textFromDetail(v);
        if (d) {
          return d;
        }
      }
    }
    for (const k of ["message", "error", "msg", "errors", "issues"] as const) {
      const v = o[k];
      if (Array.isArray(v) && v.length > 0) {
        const nested = textFromErrorField(v, depth + 1);
        if (nested) {
          return nested;
        }
      } else if (v && typeof v === "object" && !Array.isArray(v)) {
        const nested = textFromErrorField(v, depth + 1);
        if (nested) {
          return nested;
        }
      }
    }
  }
  return undefined;
}

type ApiErrorJsonShape = {
  error?: unknown;
  message?: unknown;
  /** 与 `message` 并存的简写，部分网关/框架使用 */
  msg?: unknown;
  /** GraphQL/REST/Stripe 等常见可读说明 */
  description?: unknown;
  /** 如 OAuth / 限流 等补充原因 */
  reason?: unknown;
  /** 业务或协议层错误码，常与 `message` 二选一出现 */
  code?: unknown;
  detail?: unknown;
  errors?: unknown;
  issues?: unknown;
};

export function messageFromApiErrorBody(raw: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }

  if (typeof parsed === "string" && parsed.trim().length > 0) {
    return parsed.trim();
  }
  if (typeof parsed === "number" && Number.isFinite(parsed)) {
    return String(parsed);
  }
  if (Array.isArray(parsed) && parsed.length > 0) {
    for (const el of parsed) {
      if (typeof el === "string" && el.trim().length > 0) {
        return el.trim();
      }
      const t = textFromErrorField(el);
      if (t) {
        return t;
      }
    }
    return undefined;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return undefined;
  }

  const j = parsed as ApiErrorJsonShape;
  const fromErr = textFromErrorField(j.error);
  if (fromErr) {
    return fromErr;
  }
  const fromMsg = textFromErrorField(j.message);
  if (fromMsg) {
    return fromMsg;
  }
  const fromMsgShort = textFromErrorField(j.msg);
  if (fromMsgShort) {
    return fromMsgShort;
  }
  const fromDescription = textFromErrorField(j.description);
  if (fromDescription) {
    return fromDescription;
  }
  const fromReason = textFromErrorField(j.reason);
  if (fromReason) {
    return fromReason;
  }
  const fromCode = textFromErrorField(j.code);
  if (fromCode) {
    return fromCode;
  }
  const fromDetail = textFromDetail(j.detail);
  if (fromDetail) {
    return fromDetail;
  }
  const ex = j as { error_description?: unknown; title?: unknown; hint?: unknown };
  const fromEd = textFromErrorField(ex.error_description);
  if (fromEd) {
    return fromEd;
  }
  const fromTitle = textFromErrorField(ex.title);
  if (fromTitle) {
    return fromTitle;
  }
  const fromHint = textFromErrorField(ex.hint);
  if (fromHint) {
    return fromHint;
  }
  if (Array.isArray(j.errors) && j.errors.length > 0) {
    const t = textFromErrorField(j.errors[0]);
    if (t) {
      return t;
    }
  }
  if (Array.isArray(j.issues) && j.issues.length > 0) {
    const t = textFromErrorField(j.issues[0]);
    if (t) {
      return t;
    }
  }
  if (j.errors != null && !Array.isArray(j.errors)) {
    const t = textFromErrorField(j.errors);
    if (t) {
      return t;
    }
  }
  if (j.issues != null && !Array.isArray(j.issues)) {
    const t = textFromErrorField(j.issues);
    if (t) {
      return t;
    }
  }
  return undefined;
}
