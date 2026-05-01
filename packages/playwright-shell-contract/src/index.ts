/**
 * Electron 客户端 `playwright-browser-profiles.json` 与 `POST …/runner/playwright-profiles/sync` 共用规则。
 */

export const PROFILE_SLUG_PATTERN = /^[a-z][a-z0-9_-]{1,62}$/;

/** 返回值非空时为面向用户的错误摘要；通过时为 `null`。 */
export function validateProfileSlug(slug: string | undefined | null): string | null {
  if (slug == null || typeof slug !== "string") {
    return "Slug 须为字符串（2–63 字符，小写开头，仅字母、数字、短横线与下划线）";
  }
  const s = slug.trim().toLowerCase();
  if (s.length < 2 || s.length > 63) {
    return "Slug 长度为 2–63";
  }
  if (!PROFILE_SLUG_PATTERN.test(s)) {
    return "Slug 只能包含小写字母、数字、短横线与下划线，须以小写字母开头";
  }
  return null;
}

/** `defaultStartPath` / `default_start_path`（空或仅空白视为未配置）。 */
export function validateDefaultStartPath(p: string | undefined | null): string | null {
  if (p == null) {
    return null;
  }
  if (typeof p !== "string") {
    return "起始地址须为字符串（相对路径或以 http/https 开头的网址）";
  }
  const t = p.trim();
  if (t.length === 0) {
    return null;
  }
  if (/\s/.test(t)) {
    return "起始地址不能含空白（相对路径或以 http/https 开头的网址）";
  }
  if (/^https?:\/\//i.test(t)) {
    try {
      const u = new URL(t);
      if (u.protocol !== "http:" && u.protocol !== "https:") {
        return "起始网址须为 http 或 https";
      }
      return null;
    } catch {
      return "起始网址格式无效";
    }
  }
  if (!t.startsWith("/")) {
    return "须为以 / 开头的站内相对路径，或以 http/https 开头的完整网址";
  }
  if (t.startsWith("//")) {
    return "请勿使用以 // 开头的协议相对写法，请改用 https://… 或站内 /…";
  }
  return null;
}
