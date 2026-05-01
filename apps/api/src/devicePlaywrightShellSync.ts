import {
  validateDefaultStartPath,
  validateProfileSlug,
} from "@zhizhu/playwright-shell-contract";
import { resolveBizDeviceIdCanonical } from "./deviceJwt.js";
import { getPool, rethrowIfInternalError } from "./db.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(s: string): boolean {
  return UUID_RE.test(s.trim());
}

function pickStr(v: unknown): string | undefined {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;
}

function pickStrOrNull(v: unknown): string | null | undefined {
  if (v === null) {
    return null;
  }
  if (typeof v === "string") {
    const t = v.trim();
    return t.length === 0 ? null : t;
  }
  return undefined;
}

/** 键存在且值既非 null/undefined 也非 string → 与「缺省」区分，避免 number 等被 pickStr 悄悄吞掉 */
function rejectIfJsonKeyHasNonStringValue(row: Record<string, unknown>, key: string): string | null {
  if (!Object.prototype.hasOwnProperty.call(row, key)) {
    return null;
  }
  const v = row[key];
  if (v === null || v === undefined) {
    return null;
  }
  if (typeof v !== "string") {
    return `${key} 须为字符串`;
  }
  return null;
}

export type PlaywrightShellProfileSyncRow = {
  client_profile_id: string;
  browser_profile_slug: string;
  display_label: string;
  default_start_path: string | null;
  last_opened_at_client: string | null;
};

/**
 * 设备 Bearer：全量同步客户端上报的 Playwright 配置（删除端上已不存在的行）。
 *
 * `body` 类型放宽为 `unknown`：`readJsonBody` 可能返回 `null` / 数组 / 字符串等非对象 JSON，
 * 这里运行时校验为对象再访问字段，避免「Cannot read property 'profiles' of null」漂出 400。
 */
export async function syncPlaywrightShellProfilesFromDevice(
  tenantId: string,
  deviceId: string,
  body: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const tid = tenantId.trim().toLowerCase();
  if (!tid || !deviceId.trim()) {
    return { ok: false as const, error: "tenant_id 或 device_id 无效" };
  }
  const devRes = await resolveBizDeviceIdCanonical(tenantId, deviceId);
  if (!devRes.ok) {
    return { ok: false as const, error: devRes.error };
  }
  const did = devRes.device_id;
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false as const, error: "请求体须为 JSON 对象（含 profiles 数组与可选 default_profile_id）" };
  }
  const root = body as Record<string, unknown>;
  const rawProfiles = root.profiles;
  if (!Array.isArray(rawProfiles)) {
    return { ok: false as const, error: "body.profiles 须为数组（可为空，表示清空云端登记）" };
  }
  const defaultRaw = root.default_profile_id;
  let defaultClientId: string | null = null;
  if (defaultRaw === null || defaultRaw === undefined || defaultRaw === "") {
    defaultClientId = null;
  } else if (typeof defaultRaw === "string" && isUuid(defaultRaw)) {
    defaultClientId = defaultRaw.trim().toLowerCase();
  } else {
    return { ok: false as const, error: "default_profile_id 须为合法 UUID 或 null" };
  }

  const rows: PlaywrightShellProfileSyncRow[] = [];
  const seenClient = new Set<string>();
  const seenSlug = new Set<string>();
  for (const item of rawProfiles) {
    if (typeof item !== "object" || item === null) {
      return { ok: false as const, error: "profiles 数组元素须为对象" };
    }
    const o = item as Record<string, unknown>;

    for (const key of ["client_profile_id", "browser_profile_slug", "display_label", "default_start_path", "last_opened_at"] as const) {
      const err = rejectIfJsonKeyHasNonStringValue(o, key);
      if (err != null) {
        return { ok: false as const, error: err };
      }
    }

    const cid = pickStr(o.client_profile_id);
    const slug = pickStr(o.browser_profile_slug)?.toLowerCase();
    const label = pickStr(o.display_label);
    if (!cid || !isUuid(cid)) {
      return { ok: false as const, error: "每条须含合法 client_profile_id（UUID）" };
    }
    if (!slug) {
      return { ok: false as const, error: "每条须含 browser_profile_slug" };
    }
    const slugErr = validateProfileSlug(slug);
    if (slugErr != null) {
      return { ok: false as const, error: `browser_profile_slug：${slugErr}` };
    }
    if (!label) {
      return { ok: false as const, error: "display_label 不能为空" };
    }
    if (label.length > 200) {
      return { ok: false as const, error: "display_label 长度须在 1–200 字符" };
    }
    const dsp = pickStrOrNull(o.default_start_path);
    if (dsp !== undefined && dsp !== null) {
      const pathErr = validateDefaultStartPath(dsp);
      if (pathErr != null) {
        return { ok: false as const, error: `default_start_path：${pathErr}` };
      }
    }
    let lastOp: string | null = null;
    const lo = pickStrOrNull(o.last_opened_at);
    if (lo !== undefined && lo !== null) {
      const t = Date.parse(lo);
      if (Number.isNaN(t)) {
        return { ok: false as const, error: "last_opened_at 须为合法 ISO 时间" };
      }
      lastOp = new Date(t).toISOString();
    }
    const cidl = cid.trim().toLowerCase();
    if (seenClient.has(cidl)) {
      return { ok: false as const, error: "client_profile_id 在 payload 中重复" };
    }
    seenClient.add(cidl);
    if (seenSlug.has(slug)) {
      return { ok: false as const, error: "browser_profile_slug 在 payload 中重复" };
    }
    seenSlug.add(slug);
    rows.push({
      client_profile_id: cidl,
      browser_profile_slug: slug,
      display_label: label,
      default_start_path: dsp === undefined ? null : dsp,
      last_opened_at_client: lastOp,
    });
  }

  if (defaultClientId != null && !seenClient.has(defaultClientId)) {
    return { ok: false as const, error: "default_profile_id 须对应本次同步中的某条 client_profile_id" };
  }

  const pool = getPool();
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query(
      `DELETE FROM biz_device_playwright_shell_profile WHERE tenant_id = $1 AND device_id = $2`,
      [tid, did],
    );
    for (const r of rows) {
      const isDef = defaultClientId != null && r.client_profile_id === defaultClientId;
      await c.query(
        `INSERT INTO biz_device_playwright_shell_profile (
           tenant_id, device_id, client_profile_id, browser_profile_slug, display_label,
           default_start_path, last_opened_at_client, is_default_profile, updated_at
         ) VALUES ($1, $2, $3::uuid, $4, $5, $6, $7, $8, now())`,
        [
          tid,
          did,
          r.client_profile_id,
          r.browser_profile_slug,
          r.display_label,
          r.default_start_path,
          r.last_opened_at_client,
          isDef,
        ],
      );
    }
    await c.query("COMMIT");
    return { ok: true as const };
  } catch (e) {
    try {
      await c.query("ROLLBACK");
    } catch {
      /* noop */
    }
    /** 内部异常（ReferenceError 之类）不该被当业务错回吐——重抛让路由 sanitize 返 500，
     * 才能立刻在服务端日志看到 stack；之前正是 `UUID_RE is not defined` 这条直接被回吐
     * 给 Electron 客户端，长期掩盖了 API 本身的代码缺陷。 */
    rethrowIfInternalError(e);
    const msg = e instanceof Error ? e.message : String(e);
    if (/42P01|relation.*does not exist/i.test(msg)) {
      return {
        ok: false as const,
        error: "表不存在，请在 apps/api 执行 npm run migrate（031_biz_device_playwright_shell_profile）。",
      };
    }
    return { ok: false as const, error: msg };
  } finally {
    c.release();
  }
}
