const STORAGE_KEY = "zhizhu.session.v1";

const SESSION_CHANGE_EVENT = "zhizhu:session-changed";

/**
 * 同一份 JSON 再次写入时，storage 自串不变；`useSyncExternalStore` 仅凭字符串会漏掉重渲。
 * 在每次会改变会话含义的写操作后自增，保证订阅者拿到新 snapshot。
 */
let sessionStoreRevision = 0;

function notificationTick() {
  sessionStoreRevision = (sessionStoreRevision + 1) >>> 0;
}

function notifySessionChanged() {
  notificationTick();
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(new Event(SESSION_CHANGE_EVENT));
}

export type SessionPayload = {
  tenantId: string;
  /** 占位：接入 OIDC / 账密后写入展示名 */
  displayName?: string;
  /** POST /api/v1/auth/login 后写入，用于界面展示 */
  email?: string;
  /** 登录用户名（与邮箱二选一可登录） */
  loginUsername?: string;
  /** 配置 JWT_SECRET 时由登录换票写入，用于 Authorization */
  accessToken?: string;
  /** 登录接口返回的 roles；含 platform_admin 时可切换任意租户控制台 */
  roles?: string[];
  /** 由 roles 派生，便于路由守卫 */
  platformAdmin?: boolean;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

export function getSession(): SessionPayload | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) {
      return null;
    }
    const tenantIdRaw = parsed.tenantId;
    const tenantId =
      typeof tenantIdRaw === "string" && tenantIdRaw.length > 0 ? tenantIdRaw.trim().toLowerCase() : "";
    if (!tenantId) {
      return null;
    }
    const displayName = parsed.displayName;
    const email = parsed.email;
    const loginUsername = parsed.loginUsername;
    const accessToken = parsed.accessToken;
    const rolesRaw = parsed.roles;
    const roles = Array.isArray(rolesRaw) ? rolesRaw.filter((x): x is string => typeof x === "string") : undefined;
    const platformAdmin = parsed.platformAdmin === true;
    return {
      tenantId,
      displayName:
        typeof displayName === "string" && displayName.trim().length > 0 ? displayName.trim() : undefined,
      email: typeof email === "string" && email.trim().length > 0 ? email.trim().toLowerCase() : undefined,
      loginUsername:
        typeof loginUsername === "string" && loginUsername.trim().length > 0
          ? loginUsername.trim().toLowerCase()
          : undefined,
      accessToken: typeof accessToken === "string" && accessToken.length > 0 ? accessToken : undefined,
      roles: roles && roles.length > 0 ? roles : undefined,
      platformAdmin: platformAdmin || (roles?.includes("platform_admin") ?? false),
    };
  } catch {
    return null;
  }
}

export function setSession(payload: SessionPayload) {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  notifySessionChanged();
}

export function clearSession() {
  sessionStorage.removeItem(STORAGE_KEY);
  notifySessionChanged();
}

export function getSessionKeySnapshot(): string {
  if (typeof window === "undefined") {
    return "";
  }
  try {
    return sessionStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

/** 供 `useSession` 的 `useSyncExternalStore`；含 revision，避免「内容相同」不触发订阅更新。 */
export function getSessionStoreSnapshot(): string {
  const k = getSessionKeySnapshot();
  return `${String(sessionStoreRevision)}\0${k}`;
}

export function subscribeSessionChanges(callback: () => void): () => void {
  if (typeof window === "undefined") {
    return () => undefined;
  }
  const onCustom = () => {
    callback();
  };
  const onStorage = (e: StorageEvent) => {
    if (e.storageArea === window.sessionStorage && (e.key === null || e.key === STORAGE_KEY)) {
      callback();
    }
  };
  window.addEventListener(SESSION_CHANGE_EVENT, onCustom);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(SESSION_CHANGE_EVENT, onCustom);
    window.removeEventListener("storage", onStorage);
  };
}
