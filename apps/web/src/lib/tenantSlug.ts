/**
 * 与 `apps/api` 租户 URL 段、`GET /api/v1/tenant-registry/...`、以及 `apps/client` `isValidTenantSlug` 一致。
 * 小写 1–63 字符；首字符须为字母或数字。
 */
const TENANT_SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,62}$/;

export function isValidTenantSlug(s: string): boolean {
  return TENANT_SLUG_RE.test(s);
}
