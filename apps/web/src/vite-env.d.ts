/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 配置后列表类请求走真实 HTTP（Cookie 会话 + JSON） */
  readonly VITE_API_BASE_URL?: string;
  /** 设备绑定页「下载客户端」跳转地址（与客户端 ZHIZHU_RELEASES_PAGE_URL 一致） */
  readonly VITE_ZHIZHU_RELEASES_PAGE_URL?: string;
  /** mock 延迟毫秒数，默认 120 */
  readonly VITE_MOCK_LATENCY_MS?: string;
  /** 是否显示登录页「注册」入口 */
  readonly VITE_CONSOLE_PUBLIC_REGISTER?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
