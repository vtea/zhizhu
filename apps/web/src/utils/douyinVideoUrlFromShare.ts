/** 匹配分享文案中的抖音视频短链（首个）。 */
const DOUYIN_V_SHORT = /https?:\/\/v\.douyin\.com\/[A-Za-z0-9_-]+\/?/i;

/**
 * 从粘贴的抖音分享全文里提取标准短链；若无短链则返回 trim 后的原文。
 * 成功匹配时统一为 https、且路径以 `/` 结尾。
 */
export function normalizeDouyinVideoUrlFromShare(raw: string): string {
  const s = raw.trim();
  if (!s) {
    return "";
  }
  const m = s.match(DOUYIN_V_SHORT);
  if (!m) {
    return s;
  }
  let u = m[0];
  if (!u.endsWith("/")) {
    u += "/";
  }
  if (u.startsWith("http://")) {
    u = `https://${u.slice("http://".length)}`;
  }
  return u;
}
