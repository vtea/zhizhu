import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    /** 开发端口须与 e2e-playwright-zhizhu-web（baseURL/preflight 均指 5173）一致；
     *  生产 8080 是 Docker web 容器的宿主映射，与本地开发端口无关，勿混改 */
    port: 5173,
    /**
     * 显式绑 IPv4 回环：默认 `localhost` 在部分 Windows/Node 组合下只绑 `::1`，
     * E2E 的 `http://127.0.0.1:5173` 入口会连不上；浏览器访问 localhost 会自动回退 IPv4。
     */
    host: "127.0.0.1",
  },
});
