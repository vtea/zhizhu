/**
 * 须与 apps/api/src/consoleAuth.ts 中 isValidLoginUsername 规则保持一致
 *（3–32 位，小写字母/数字，开头须为字母或数字，可含 _ -）
 */
export const LOGIN_USERNAME_PATTERN = /^[a-z0-9][a-z0-9_-]{2,31}$/;

export const LOGIN_USERNAME_HINT = "3–32 位小写；字母或数字开头；可含 _ -；不可含 @";

export function validateLoginUsernameClient(u: string): string | null {
  const s = u.trim().toLowerCase();
  if (!s) {
    return "请填写用户名";
  }
  if (s.includes("@")) {
    return "用户名不能含 @（请用邮箱字段填写邮箱）";
  }
  if (!LOGIN_USERNAME_PATTERN.test(s)) {
    return `用户名格式无效：${LOGIN_USERNAME_HINT}`;
  }
  return null;
}
