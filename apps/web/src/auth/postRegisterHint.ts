const KEY = "zhizhu.postRegister.v1";
const MAX_AGE_MS = 60 * 60 * 1000;

export type PostRegisterHint = {
  registeredTenant: string;
  registeredEmail: string;
  registeredLogin: string;
};

export function savePostRegisterHint(p: PostRegisterHint) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ ...p, at: Date.now() }));
  } catch {
    /* 配额/隐私模式 */
  }
}

/** 读一次即删，避免长期残留；超期则忽略并清理。 */
export function consumePostRegisterHint(): PostRegisterHint | null {
  if (typeof window === "undefined") {
    return null;
  }
  let raw: string | null;
  try {
    raw = sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
  if (!raw) {
    return null;
  }
  try {
    const p = JSON.parse(raw) as PostRegisterHint & { at?: number };
    if (p.at != null && Date.now() - p.at > MAX_AGE_MS) {
      sessionStorage.removeItem(KEY);
      return null;
    }
    sessionStorage.removeItem(KEY);
    const hasLogin = typeof p.registeredLogin === "string" && p.registeredLogin.length > 0;
    const hasEmail = typeof p.registeredEmail === "string" && p.registeredEmail.length > 0;
    if (typeof p.registeredTenant === "string" && p.registeredTenant.length > 0 && (hasLogin || hasEmail)) {
      return {
        registeredTenant: p.registeredTenant,
        registeredEmail: typeof p.registeredEmail === "string" ? p.registeredEmail : "",
        registeredLogin: typeof p.registeredLogin === "string" ? p.registeredLogin : "",
      };
    }
    return null;
  } catch {
    try {
      sessionStorage.removeItem(KEY);
    } catch {
      /* noop */
    }
    return null;
  }
}

export function clearPostRegisterHint() {
  if (typeof window === "undefined") {
    return;
  }
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* noop */
  }
}
