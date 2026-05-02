/**
 * Chromium `page.goto` 常见瞬时网络错误：用于规则 `goto` 与会话启动首跳的重试判定。
 */
export function sleepMs(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** 非此类错误不自动重试，以免掩盖 URL/配置问题。 */
export function isTransientNetNavError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("err_connection_closed") ||
    m.includes("err_connection_reset") ||
    m.includes("err_empty_response") ||
    m.includes("err_socket_not_connected") ||
    m.includes("err_network_changed")
  );
}
