/** 壳页 DOM 小工具：供 renderer 与 logPanel 共用，避免循环依赖 */

export function setStatus(msg: string, kind: "info" | "error" = "info"): void {
  const s = document.getElementById("status");
  if (!s) {
    return;
  }
  s.textContent = msg;
  s.className = `status ${kind}`;
  if (msg.trim().length > 0) {
    try {
      s.scrollIntoView({ behavior: "smooth", block: "nearest" });
    } catch {
      s.scrollIntoView({ block: "nearest" });
    }
  }
}

export function setBaseHint(text: string): void {
  const baseEl = document.getElementById("base");
  if (baseEl) {
    baseEl.textContent = text;
  }
}

/** 避免主进程偶发阻塞导致 invoke 永不返回，界面一直停在「加载中…」 */
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
