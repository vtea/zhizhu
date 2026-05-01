# @zhizhu/playwright-browser-fingerprint

仓库内**唯一**启动 Chromium 的入口。所有 `apps/runner` / `apps/client` / `tools/` 里的 Playwright 子进程，
启动持久 / 一次性浏览器都必须走本包，避免漏指纹被抖音 / leads.cluerich.com 等域识别成 bot。

## 推荐 API

```ts
import {
  launchFingerprintedPersistentContext,   // 持久 profile（cookie / storage 落到 userDataDir）
  launchFingerprintedBrowserContext,       // 一次性匿名/带 storageState 的非持久会话
} from "@zhizhu/playwright-browser-fingerprint";

// 持久（headed-login / task-rule）
const context = await launchFingerprintedPersistentContext({
  userDataDir: "/path/to/profile",
  headless: false,
  // 可选：浅合并到指纹默认 launch options（同名键覆盖；args 数组追加而非覆盖）
  extraOptions: { viewport: null, args: ["--start-maximized"] },
});

// 一次性（probe / codegen / 测试）
const { browser, context, seed } = await launchFingerprintedBrowserContext({
  headless: true,
  extraNewContextOptions: { storageState: "/path/auth.json" },
});
```

两个入口都会一次性完成：

1. 解析 seed（`ZHIZHU_PW_FINGERPRINT_SEED` → `ZHIZHU_PW_PROFILE_CLIENT_ID` → userDataDir hash）
2. 应用 launch / context 选项（UA / viewport / locale / timezone / `--disable-blink-features=AutomationControlled` 等）
3. `addInitScript` 注入完整反检测 shim：
   - `navigator.webdriver = false`
   - `window.chrome.runtime`（headless 默认缺失）
   - `navigator.plugins`（非空，仿真 PDF Viewer 五件套）
   - `navigator.languages`（与 locale 自洽）
   - `navigator.permissions.query({ name: "notifications" })` 与 `Notification.permission` 自洽
  - `WebGL UNMASKED_VENDOR_WEBGL / UNMASKED_RENDERER_WEBGL` 与 family（mac / win）一致
   - `navigator.platform / hardwareConcurrency / deviceMemory`
   - iframe `contentWindow.chrome` 同步

## 环境变量

- `ZHIZHU_PW_FINGERPRINT_SEED`（推荐 `profileUuid:slug`）：决定 seed → 同一 profile 多次启动指纹稳定
- `ZHIZHU_PW_PROFILE_CLIENT_ID`：备选种子
- `ZHIZHU_PW_FINGERPRINT_DEBUG=1`：在 stderr 输出 `event=fingerprint_preview` 便于排查

## 桌面端约束（重要）

- 当前策略固定为**仅桌面端指纹**，`family` 只会是 `win` / `mac`。
- 不再生成 Android UA、移动 viewport、`isMobile=true`、`hasTouch=true` 的组合。

## 历史 profile 迁移与排障

切到仅桌面端后，已有 profile 通常无需迁移 seed 或重建目录；若仍出现移动端返回，可按顺序排查：

1. 先重启该 profile 对应的 Playwright 会话（多数场景会直接恢复桌面返回）。
2. 若仍异常，清理该 profile 的站点 cookies/storage 后重新登录。
3. 若仍异常，删除并重建该 profile（或手动清空该 profile 的 `userDataDir` 后再登录）。

## 守约束

`launchEntrypoints.contract.test.ts` 静态扫描全仓库 `chromium.launch*` 调用，禁止业务代码绕过本包。
新写一个文件想直接 launch 时，要么用上述 helper，要么在调用处紧邻添加：

```ts
// allow-raw-launch: <理由，例如 "smoke test only goes to about:blank">
const browser = await chromium.launch({ headless: true });
```

并把文件加到 `ALLOWED_RAW_LAUNCH_FILES`。

```bash
npm run test:fingerprint   # 跑 contract 测试
```

## 低层 API（一般不直接用）

- `buildBrowserLikePersistentContextOptions(seed)`：仅返回 launch options，不注入 init script
- `installBrowserLikeFingerprintScripts(context, seed?)`：仅注入 init script 到已存在的 context
- `resolveFingerprintSeedFromEnv(env, { userDataDirFallback })`
- `describeFingerprint(seed)`：返回 family / UA snippet / viewport，便于排错

依赖 `playwright`（peer，`^1.49.0`）。
