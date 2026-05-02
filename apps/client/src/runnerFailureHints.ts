/**
 * 将 Runner 的 error_code / error_message 转为终端用户可读文案（不改变 error_code）。
 */
export function augmentRunnerErrorMessageForDisplay(
  errorCode: string | undefined,
  errorMessage: string | undefined,
): string {
  const em = typeof errorMessage === "string" ? errorMessage.trim() : "";
  if (em.length === 0) {
    return em;
  }
  if (errorCode === "NAV_FAILED" && /ERR_CONNECTION_CLOSED|ERR_CONNECTION_RESET|ERR_EMPTY_RESPONSE/i.test(em)) {
    return `${em}\n\n提示：连接在页面加载完成前被关闭，多为网络不稳定、企业防火墙或站点限流。请用系统浏览器打开同一地址试连，或换网络/时段；必要时开启有头任务模式对比。`;
  }
  if (/Target page, context or browser has been closed/i.test(em) && !/资料目录只能被一个 Chromium 使用/i.test(em)) {
    return `${em}\n\n提示：页面或浏览器已被关闭。常见原因：任务执行超过本机硬超时（长列表滚轮）、同一 Playwright 资料目录被其它窗口/试跑占用，或 Chromium 异常退出。可适当减少滚轮次数、设置环境变量 ZHIZHU_TASK_RULE_HARD_TIMEOUT_MS，或关闭占用该 Profile 的其它会话后再试。`;
  }
  return em;
}
