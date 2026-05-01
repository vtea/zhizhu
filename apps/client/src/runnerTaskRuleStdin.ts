/**
 * Runner `task-rule` 单次 stdin：`write()+end()` 在连续调用时若在反压下可能半包就结束了流。
 * `end(chunk, encoding, cb)` 由 Writable 队列保证整块进入关闭序列（见 Node.js `Writable.prototype.end`）。
 */
export async function closeStdinWithTaskRuleJsonPayload(
  stdin: NodeJS.WritableStream | null | undefined,
  payload: Record<string, unknown>,
): Promise<void> {
  if (!stdin) {
    throw new Error("子进程 stdin 不可用");
  }
  const chunk = JSON.stringify(payload);
  await new Promise<void>((resolve, reject) => {
    stdin.once("error", reject);
    stdin.end(chunk, "utf8", () => {
      stdin.removeListener("error", reject);
      resolve();
    });
  });
}
