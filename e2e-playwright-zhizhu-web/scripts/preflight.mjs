/**
 * 在跑 Playwright 前快速探测 API / Web 是否可连；不替代完整 Readme 说明。
 * 需跳过可设置环境变量: SKIP_E2E_PREFLIGHT=1
 */
import http from "node:http";

if (process.env.SKIP_E2E_PREFLIGHT) process.exit(0);

function get(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (r) => {
      r.resume();
      resolve(r.statusCode ?? 0);
    });
    req.on("error", reject);
    req.setTimeout(2500, () => {
      req.destroy();
      reject(new Error("timeout"));
    });
  });
}

async function main() {
  const apiHealth = (process.env.E2E_API_HEALTH_URL || "http://127.0.0.1:3000/health").replace(
    /\/$/,
    ""
  );
  const web = process.env.E2E_WEB_URL || "http://127.0.0.1:5173/";

  try {
    const code = await get(`${apiHealth}`);
    // 与 Web 预检一致：2xx/3xx 表示有服务在响应（含中间层 301/302；5xx/4xx 仍失败，例如 DB 未连时 /health 为 503）
    if (code < 200 || code >= 400) {
      console.error(`[e2e] ${apiHealth} 返回状态 ${code}，请确认 API 已就绪`);
      process.exit(1);
    }
  } catch {
    console.error(`[e2e] 无法连到 ${apiHealth}：请先启动 apps/api（可设 E2E_API_HEALTH_URL）`);
    process.exit(1);
  }

  try {
    const code = await get(web);
    // 2xx/3xx 均视为有进程在监听（防代理、History fallback、或中间层 302；仅 4xx/5xx 当失败）
    if (code < 200 || code >= 400) {
      console.error(`[e2e] ${web} 返回状态 ${code}，请确认 Vite 已就绪`);
      process.exit(1);
    }
  } catch {
    console.error(
      "[e2e] 无法连到 Web 开发服（默认同地址 127.0.0.1:5173，可设 E2E_WEB_URL=…）"
    );
    process.exit(1);
  }
}

main();
