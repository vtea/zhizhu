/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 配置后列表类请求走真实 HTTP（Cookie 会话 + JSON） */
  readonly VITE_API_BASE_URL?: string;
  /** mock 延迟毫秒数，默认 120 */
  readonly VITE_MOCK_LATENCY_MS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
