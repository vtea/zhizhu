/** 与 consoleAuth 登录成功后的 user 形状一致，避免与 consoleAuth 循环 import */
export type AuthSessionUserLike = {
  tenant_id: string;
  login_username: string;
  email: string;
  display_name: string | null;
  roles: string[];
};

/** 从 POST body 解析登录名（用户名或邮箱）；兼容 login_identifier / email / username */
export function pickLoginIdentifier(body: Record<string, unknown>): string {
  if (typeof body.login_identifier === "string") {
    return body.login_identifier;
  }
  if (typeof body.email === "string") {
    return body.email;
  }
  if (typeof body.username === "string") {
    return body.username;
  }
  return "";
}

/** 注册：username 或 login_username */
export function pickRegisterUsername(body: Record<string, unknown>): string {
  if (typeof body.username === "string") {
    return body.username;
  }
  if (typeof body.login_username === "string") {
    return body.login_username;
  }
  return "";
}

function pickNonEmpty(...candidates: (string | null | undefined)[]): string {
  for (const c of candidates) {
    const t = typeof c === "string" ? c.trim() : "";
    if (t.length > 0) {
      return t;
    }
  }
  return "用户";
}

/** 展示名：忽略空串，避免 `??` 把 `""` 当成有效值导致 JWT 响应里 display_name 为空 */
export function displayNameForSession(user: AuthSessionUserLike): string {
  return pickNonEmpty(user.display_name, user.login_username, user.email);
}

export function pgErrorCode(e: unknown): string | undefined {
  if (typeof e === "object" && e !== null && "code" in e) {
    const c = (e as { code?: unknown }).code;
    return typeof c === "string" ? c : undefined;
  }
  return undefined;
}
