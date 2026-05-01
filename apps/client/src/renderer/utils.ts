/** 渲染进程通用小工具：状态文案、超时包裹、时间格式化等。 */

/** 与原 shellDomUtils.withTimeout 等价：避免主进程偶发阻塞导致 invoke 永不返回。 */
export function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      reject(new Error(`${label} 超时（${ms / 1000}s），请查看终端主进程日志或重开客户端`));
    }, ms);
    void p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

export function formatProbeClock(): string {
  try {
    return new Date().toLocaleTimeString("zh-CN", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return new Date().toISOString().slice(11, 19);
  }
}

export function formatTs(iso?: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

/** 与 apps/web Vite dev / API 端口默认一致；renderer 不能 import config.ts（其依赖 process.env）。 */
export const DEFAULT_API_BASE_FALLBACK = "http://127.0.0.1:3000/";
