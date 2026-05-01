/**
 * 类真实设备指纹：与「 headed-login / 任务采集 」共用同一套稳定 seed → launch 选项，
 * 并由主进程设置 `ZHIZHU_PW_FINGERPRINT_SEED`（建议 `profileUuid:slug`）对齐各 profile。
 *
 * **本包是项目内启动 Chromium 的唯一入口（contract）。** 任何新写的代码都应使用：
 *   - {@link launchFingerprintedPersistentContext}（持久 profile，目录隔离 cookies / storage）
 *   - {@link launchFingerprintedBrowserContext}（一次性匿名/带 storageState 的非持久会话）
 * 而**不应**直接 import `chromium.launch*`。两者都会一次性 ① apply 指纹 launch 选项、
 * ② addInitScript 全套 anti-detect shim，调用方再不能漏一项。
 *
 * 例外：仓库内只有指纹包自身、`apps/runner/src/cli.ts` 的 cmdSmoke（仅 about:blank 健康检查）以及
 * 测试脚本可以使用原生 `chromium.launch`；这些点都标注了 `// allow-raw-launch:` 注释，
 * 配套的 [`launchEntrypoints.contract.test.ts`](./launchEntrypoints.contract.test.ts) 守住边界。
 */
import type { BrowserContext, BrowserContextOptions } from "playwright";
import { chromium } from "playwright";

/** 主进程 / 任务 Runner 应设置的种子（与 Electron `playwrightHeadedProcess` 一致） */
export const ENV_FINGERPRINT_SEED = "ZHIZHU_PW_FINGERPRINT_SEED";

/** 备选：仅客户端内部 UUID 时可用 */
export const ENV_FINGERPRINT_PROFILE_CLIENT_ID = "ZHIZHU_PW_PROFILE_CLIENT_ID";

type LaunchPersistentFingerprintOptions = NonNullable<Parameters<typeof chromium.launchPersistentContext>[1]>;

function fnv1a32(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** 可复现的简易 PRNG（mulberry32） */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return (): number => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickIndex(rng: () => number, len: number): number {
  return Math.floor(rng() * len) % len;
}

function hashUserDataDirFallback(userDataDir: string): string {
  const n = Array.from(userDataDir).reduce((acc, ch) => (acc + ch.charCodeAt(0) * 31) >>> 0, 0);
  return `user-data-dir-hash:${Math.abs(n).toString(16)}`;
}

/**
 * 解析与 headed-login 一致的种子：优先 `ZHIZHU_PW_FINGERPRINT_SEED`，其次客户端 UUID，再退化为目录 hash。
 */
export function resolveFingerprintSeedFromEnv(
  env: NodeJS.ProcessEnv | undefined = process.env,
  opts?: { userDataDirFallback?: string },
): string {
  const a = typeof env?.[ENV_FINGERPRINT_SEED] === "string" ? env[ENV_FINGERPRINT_SEED].trim() : "";
  if (a.length > 0) {
    return a;
  }
  const b =
    typeof env?.[ENV_FINGERPRINT_PROFILE_CLIENT_ID] === "string" ? env[ENV_FINGERPRINT_PROFILE_CLIENT_ID].trim() : "";
  if (b.length > 0) {
    return b;
  }
  const dir = opts?.userDataDirFallback?.trim();
  if (dir && dir.length > 0) {
    return hashUserDataDirFallback(dir);
  }
  return "default-unknown-seed";
}

const CHROME_BUILD_TRIPLES: readonly string[] = [
  "129.0.6668.58",
  "130.0.6723.116",
  "131.0.6778.69",
  "131.0.6778.108",
  "132.0.6834.83",
];

const WIN_UA = (trip: string): string =>
  `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${trip} Safari/537.36`;

const MAC_UA = (trip: string, macOs: "10_15_7" | "11_7_10" | "12_7_2" | "13_6_3" | "14_5_1"): string =>
  `Mozilla/5.0 (Macintosh; Intel Mac OS X ${macOs}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${trip} Safari/537.36`;

const MAC_OS_TAGS = ["10_15_7", "11_7_10", "12_7_2", "13_6_3", "14_5_1"] as const;

const DESKTOP_VIEWPORTS: ReadonlyArray<{ width: number; height: number; dpr: number }> = [
  { width: 1920, height: 1040, dpr: 1 },
  { width: 1680, height: 1050, dpr: 2 },
  { width: 1536, height: 864, dpr: 1.25 },
  { width: 1440, height: 900, dpr: 2 },
  { width: 1366, height: 768, dpr: 1 },
  { width: 1280, height: 800, dpr: 1 },
  { width: 1280, height: 720, dpr: 1 },
];

const TIMEZONES = ["Asia/Shanghai", "Asia/Chongqing", "Asia/Hong_Kong", "Asia/Taipei", "Asia/Singapore"] as const;

const LOCALES_WEIGHTED = ["zh-CN", "zh-CN", "zh-CN", "zh-TW", "en-US"] as const;

const COLOR_SCHEMES = ["light", "dark", "light", "light"] as const;

type Family = "win" | "mac";

export type FingerprintDebugInfo = {
  family: Family;
  userAgentSnippet: string;
  viewport: { width: number; height: number };
  timezoneId: string;
  locale: string;
};

/** 供 `launchPersistentContext` 的第二参（不含 headless / userDataDir） */
export function buildBrowserLikePersistentContextOptions(seed: string): LaunchPersistentFingerprintOptions {
  const s = typeof seed === "string" && seed.trim().length > 0 ? seed.trim() : "default-profile-seed";
  const h = fnv1a32(s);
  const rng = mulberry32(h);

  const trip = CHROME_BUILD_TRIPLES[pickIndex(rng, CHROME_BUILD_TRIPLES.length)];
  const familyRoll = rng();
  let family: Family = "win";
  family = familyRoll < 0.5 ? "win" : "mac";

  const tz = TIMEZONES[pickIndex(rng, TIMEZONES.length)];
  const locale = LOCALES_WEIGHTED[pickIndex(rng, LOCALES_WEIGHTED.length)];
  const colorScheme = COLOR_SCHEMES[pickIndex(rng, COLOR_SCHEMES.length)] as "light" | "dark";

  let userAgent = "";
  let vw = DESKTOP_VIEWPORTS[pickIndex(rng, DESKTOP_VIEWPORTS.length)]!;
  let isMobile = false;
  let hasTouch = false;

  if (family === "mac") {
    const tag = MAC_OS_TAGS[pickIndex(rng, MAC_OS_TAGS.length)];
    userAgent = MAC_UA(trip, tag);
  } else {
    userAgent = WIN_UA(trip);
    vw = DESKTOP_VIEWPORTS[pickIndex(rng, DESKTOP_VIEWPORTS.length)]!;
  }

  const acceptLang =
    locale === "zh-CN"
      ? "zh-CN,zh;q=0.9,en;q=0.85,en-US;q=0.8"
      : locale === "zh-TW"
        ? "zh-TW,zh;q=0.9,en;q=0.85"
        : "en-US,en;q=0.9";

  const viewport = { width: vw.width, height: vw.height };
  const screen = {
    width: Math.round(vw.width * (1 + rng() * 0.08)),
    height: Math.round(vw.height * (1 + rng() * 0.12)),
  };

  const args: string[] = [
    "--disable-blink-features=AutomationControlled",
    `--lang=${locale}`,
    `--window-size=${viewport.width},${viewport.height}`,
  ];

  return {
    userAgent,
    viewport,
    screen,
    deviceScaleFactor: vw.dpr,
    isMobile,
    hasTouch,
    locale,
    timezoneId: tz,
    colorScheme,
    reducedMotion: rng() > 0.88 ? "reduce" : "no-preference",
    extraHTTPHeaders: {
      "Accept-Language": acceptLang,
    },
    ignoreDefaultArgs: ["--enable-automation"],
    args,
  };
}

/** @deprecated 使用 buildBrowserLikePersistentContextOptions（名称更通用） */
export function buildHeadedLoginLaunchOptions(seed: string): LaunchPersistentFingerprintOptions {
  return buildBrowserLikePersistentContextOptions(seed);
}

export function describeFingerprint(seed: string): FingerprintDebugInfo {
  const o = buildBrowserLikePersistentContextOptions(seed);
  const ua = typeof o.userAgent === "string" ? o.userAgent : "";
  const fam: Family =
    ua.includes("Windows NT") ? "win" : ua.includes("Mac OS X") ? "mac" : "win";
  return {
    family: fam,
    userAgentSnippet: ua.slice(0, Math.min(80, ua.length)),
    viewport:
      o.viewport != null ? { width: o.viewport.width, height: o.viewport.height } : { width: 0, height: 0 },
    timezoneId: typeof o.timezoneId === "string" ? o.timezoneId : "?",
    locale: typeof o.locale === "string" ? o.locale : "?",
  };
}

/**
 * 反检测 shim 注入到 `BrowserContext` 的 `addInitScript`，须在首次 `page.goto` **之前**调用。
 *
 * 单点 `navigator.webdriver = false` 已经是 2018 年的水准，主流反爬指纹库（FingerprintJS / Cloudflare bot
 * detection / Datadome）会同时检查：
 *
 * - `navigator.webdriver` → `false`
 * - `window.chrome.runtime`（Chrome 浏览器存在；Headless Chromium 默认缺失）
 * - `navigator.plugins.length > 0`（Chromium 默认 0；真机 Chrome 至少 3 个）
 * - `navigator.languages`（headless 默认 `[]`；真机 `["zh-CN","zh","en"]` 等）
 * - `navigator.permissions.query({ name: "notifications" })` → 真机返回 `prompt`，
 *   headless / `--headless=new` 老版本返回 `denied` 暴露身份
 * - WebGL `UNMASKED_VENDOR_WEBGL` / `UNMASKED_RENDERER_WEBGL` → headless 通常报 `Google Inc. SwiftShader`
 *   或 `Mesa OffScreen`，真机一般是 `Intel Inc.` / `Apple GPU` / `NVIDIA…`
 * - `navigator.hardwareConcurrency` / `deviceMemory`：真机 4–32 / 4–32，headless 偶尔为 0
 * - `Notification.permission`：与 permissions.query 必须自洽
 * - `window.outerHeight / outerWidth`：headless 与 viewport 偏差太大会被 fingerprint 抓到
 *
 * 这里的 shim 在 page 上下文（init script）里跑——seed 决定 vendor/renderer 是 Apple 还是 Intel 等，
 * 和 `buildBrowserLikePersistentContextOptions` 选定的 family（mac/win）保持一致，避免出现
 * 「UA 是 Mac 但 WebGL 写 Intel HD Graphics 4000 (Windows)」这种自相矛盾的指纹。
 */
export async function installBrowserLikeFingerprintScripts(
  context: BrowserContext,
  seed?: string,
): Promise<void> {
  const opts = buildBrowserLikePersistentContextOptions(seed ?? "default-profile-seed");
  const ua = typeof opts.userAgent === "string" ? opts.userAgent : "";
  const family: Family = ua.includes("Windows NT") ? "win" : ua.includes("Mac OS X") ? "mac" : "win";
  const seedHash = fnv1a32(seed ?? "default-profile-seed");
  const rng = mulberry32(seedHash);

  /**
   * WebGL vendor/renderer 池：与 family 对齐（Mac UA 不会出现 Intel HD Graphics 4400 + Windows 这种组合）。
   * 选项均来自真实 Chrome 在对应平台上的 UNMASKED 输出。
   */
  const winGpu: Array<{ vendor: string; renderer: string }> = [
    { vendor: "Google Inc. (Intel)", renderer: "ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)" },
    { vendor: "Google Inc. (NVIDIA)", renderer: "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)" },
    { vendor: "Google Inc. (AMD)", renderer: "ANGLE (AMD, AMD Radeon RX 6600 Direct3D11 vs_5_0 ps_5_0, D3D11)" },
    { vendor: "Google Inc. (Intel)", renderer: "ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)" },
  ];
  const macGpu: Array<{ vendor: string; renderer: string }> = [
    { vendor: "Apple Inc.", renderer: "Apple GPU" },
    { vendor: "Apple Inc.", renderer: "ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)" },
    { vendor: "Apple Inc.", renderer: "ANGLE (Apple, ANGLE Metal Renderer: Apple M2 Pro, Unspecified Version)" },
    { vendor: "Intel Inc.", renderer: "Intel(R) Iris(TM) Plus Graphics 645" },
  ];
  const gpuPool = family === "mac" ? macGpu : winGpu;
  const gpu = gpuPool[Math.floor(rng() * gpuPool.length) % gpuPool.length]!;

  const hwCoresPool = [4, 6, 8, 8, 12, 16];
  const hwCores = hwCoresPool[Math.floor(rng() * hwCoresPool.length) % hwCoresPool.length];
  const memPool = [4, 8, 8, 16, 16, 32];
  const deviceMemory = memPool[Math.floor(rng() * memPool.length) % memPool.length];

  const langs =
    typeof opts.locale === "string" && opts.locale.startsWith("zh-CN")
      ? ["zh-CN", "zh", "en"]
      : typeof opts.locale === "string" && opts.locale.startsWith("zh-TW")
        ? ["zh-TW", "zh", "en"]
        : ["en-US", "en"];

  const platform = family === "mac" ? "MacIntel" : "Win32";

  await context.addInitScript(
    (cfg: {
      vendor: string;
      renderer: string;
      langs: string[];
      platform: string;
      hwCores: number;
      deviceMemory: number;
    }) => {
      try {
        Object.defineProperty(Navigator.prototype, "webdriver", {
          configurable: true,
          enumerable: false,
          get(): boolean {
            return false;
          },
        });
      } catch {
        /* noop */
      }
      /**
       * window.chrome — 反爬最常见的检测点：headless Chromium 没有这个对象，真机 Chrome 一定有。
       * 这里只补 `runtime` 子键 + 几个 enum，不再深度仿真（深度仿真易反被另一类「过度仿真」探针识别）。
       */
      try {
        const w = window as unknown as { chrome?: Record<string, unknown> };
        if (!w.chrome) {
          w.chrome = {};
        }
        if (!w.chrome.runtime) {
          w.chrome.runtime = {
            OnInstalledReason: { CHROME_UPDATE: "chrome_update", INSTALL: "install", UPDATE: "update" },
            OnRestartRequiredReason: { APP_UPDATE: "app_update", OS_UPDATE: "os_update", PERIODIC: "periodic" },
            PlatformArch: { ARM: "arm", ARM64: "arm64", MIPS: "mips", MIPS64: "mips64", X86_32: "x86-32", X86_64: "x86-64" },
            PlatformOs: { ANDROID: "android", CROS: "cros", LINUX: "linux", MAC: "mac", OPENBSD: "openbsd", WIN: "win" },
            RequestUpdateCheckStatus: { NO_UPDATE: "no_update", THROTTLED: "throttled", UPDATE_AVAILABLE: "update_available" },
          };
        }
      } catch {
        /* noop */
      }
      /**
       * navigator.languages：headless 默认 `[]` 是经典暴露点；与 Accept-Language 头部 / locale 对齐。
       */
      try {
        Object.defineProperty(Navigator.prototype, "languages", {
          configurable: true,
          enumerable: true,
          get(): readonly string[] {
            return Object.freeze([...cfg.langs]);
          },
        });
      } catch {
        /* noop */
      }
      /**
       * navigator.plugins / mimeTypes：真机 Chrome 124+ 至少 5 个内嵌（PDF Viewer 系列）；
       * 我们仿造一个非空集合，避免 `length === 0` 立即被识别。
       */
      try {
        const fakePlugin = (name: string, filename: string, description: string): unknown => ({
          name,
          filename,
          description,
          length: 1,
          item: (): null => null,
          namedItem: (): null => null,
        });
        const plugins = [
          fakePlugin("PDF Viewer", "internal-pdf-viewer", "Portable Document Format"),
          fakePlugin("Chrome PDF Viewer", "internal-pdf-viewer", "Portable Document Format"),
          fakePlugin("Chromium PDF Viewer", "internal-pdf-viewer", "Portable Document Format"),
          fakePlugin("Microsoft Edge PDF Viewer", "internal-pdf-viewer", "Portable Document Format"),
          fakePlugin("WebKit built-in PDF", "internal-pdf-viewer", "Portable Document Format"),
        ];
        Object.defineProperty(Navigator.prototype, "plugins", {
          configurable: true,
          enumerable: true,
          get(): unknown {
            return plugins;
          },
        });
      } catch {
        /* noop */
      }
      /**
       * navigator.permissions.query：headless 老版本对 `notifications` 返回 `denied`，
       * 而 Notification.permission 又是 `default`（"prompt"）—— 这两个不一致是经典指纹。
       * 这里把 query 包一层，让 `notifications` 跟 `Notification.permission` 自洽。
       */
      try {
        const np = navigator.permissions as unknown as {
          query?: (p: { name: string }) => Promise<unknown>;
        };
        const original = np?.query?.bind(np);
        if (original) {
          (np as { query: typeof original }).query = (parameters: { name: string }): Promise<unknown> => {
            if (parameters?.name === "notifications") {
              return Promise.resolve({ state: Notification.permission, onchange: null } as unknown);
            }
            return original(parameters);
          };
        }
      } catch {
        /* noop */
      }
      /**
       * WebGL：把 UNMASKED_VENDOR_WEBGL / UNMASKED_RENDERER_WEBGL 换成与 family 一致的值。
       * 不动其它参数，避免 `getParameter(BLEND)` 之类的检测意外失败。
       */
      try {
        const patchGetParameter = (proto: unknown): void => {
          const p = proto as { prototype: { getParameter: (n: number) => unknown } };
          const original = p.prototype.getParameter;
          p.prototype.getParameter = function (parameter: number): unknown {
            // UNMASKED_VENDOR_WEBGL = 37445, UNMASKED_RENDERER_WEBGL = 37446
            if (parameter === 37445) return cfg.vendor;
            if (parameter === 37446) return cfg.renderer;
            return original.call(this, parameter);
          };
        };
        if (typeof WebGLRenderingContext !== "undefined") {
          patchGetParameter(WebGLRenderingContext);
        }
        if (typeof WebGL2RenderingContext !== "undefined") {
          patchGetParameter(WebGL2RenderingContext);
        }
      } catch {
        /* noop */
      }
      /**
       * navigator.platform / hardwareConcurrency / deviceMemory：与 family 一致。
       */
      try {
        Object.defineProperty(Navigator.prototype, "platform", {
          configurable: true,
          enumerable: true,
          get(): string {
            return cfg.platform;
          },
        });
      } catch {
        /* noop */
      }
      try {
        Object.defineProperty(Navigator.prototype, "hardwareConcurrency", {
          configurable: true,
          enumerable: true,
          get(): number {
            return cfg.hwCores;
          },
        });
      } catch {
        /* noop */
      }
      try {
        Object.defineProperty(Navigator.prototype, "deviceMemory", {
          configurable: true,
          enumerable: true,
          get(): number {
            return cfg.deviceMemory;
          },
        });
      } catch {
        /* noop */
      }
      /**
       * iframe.contentWindow.chrome 也补一下——某些反爬会在 iframe 里再探一次。
       */
      try {
        const orig = HTMLIFrameElement.prototype.contentWindow;
        if (orig && typeof orig === "object") {
          /* contentWindow 是 getter，不能直接覆盖；改在 iframe 创建后注入。 */
        }
        const proto = HTMLIFrameElement.prototype;
        const desc = Object.getOwnPropertyDescriptor(proto, "contentWindow");
        if (desc?.get) {
          const originalGet = desc.get;
          Object.defineProperty(proto, "contentWindow", {
            configurable: true,
            enumerable: desc.enumerable,
            get(): Window | null {
              const cw = originalGet.call(this) as (Window & { chrome?: unknown }) | null;
              if (cw && !cw.chrome) {
                try {
                  cw.chrome = (window as unknown as { chrome: unknown }).chrome;
                } catch {
                  /* cross-origin iframe 不能写入，忽略 */
                }
              }
              return cw;
            },
          });
        }
      } catch {
        /* noop */
      }
    },
    { vendor: gpu.vendor, renderer: gpu.renderer, langs, platform, hwCores, deviceMemory },
  );
}

/**
 * 持久化 Profile（cookie / storage 永久落地到 userDataDir）的统一启动入口。
 *
 * 内部一次完成：
 *   1. 解析种子（`ZHIZHU_PW_FINGERPRINT_SEED` → `ZHIZHU_PW_PROFILE_CLIENT_ID` → userDataDir hash）
 *   2. 应用 launch 选项（UA / viewport / locale / timezone / `--disable-blink-features=AutomationControlled` 等）
 *   3. addInitScript 注入完整反检测 shim
 *
 * 调用方传入的 `extraOptions` 会与指纹 options **浅合并**（caller 优先），便于 headed 时
 * 覆盖 `viewport: null` / `--start-maximized` 等可视化选项。
 */
export async function launchFingerprintedPersistentContext(args: {
  userDataDir: string;
  headless: boolean;
  extraOptions?: Record<string, unknown>;
  seedOverride?: string;
}): Promise<BrowserContext> {
  const seed =
    args.seedOverride && args.seedOverride.trim().length > 0
      ? args.seedOverride.trim()
      : resolveFingerprintSeedFromEnv(process.env, { userDataDirFallback: args.userDataDir });
  const fingerprintOpts = buildBrowserLikePersistentContextOptions(seed);
  const merged: Record<string, unknown> = {
    ...(fingerprintOpts as unknown as Record<string, unknown>),
    headless: args.headless,
  };
  if (args.extraOptions) {
    /**
     * 浅合并：caller 的同名键覆盖 fingerprint 默认值；`args` 数组特殊处理为合并而非覆盖，
     * 让 headed 模式可以追加 `--start-maximized` 而不丢掉 `--disable-blink-features=AutomationControlled`。
     */
    for (const [k, v] of Object.entries(args.extraOptions)) {
      if (k === "args" && Array.isArray(v) && Array.isArray(merged.args)) {
        merged.args = [...(merged.args as string[]), ...(v as string[])];
      } else {
        merged[k] = v;
      }
    }
  }
  const ctx = await chromium.launchPersistentContext(args.userDataDir, merged as Parameters<typeof chromium.launchPersistentContext>[1]);
  await installBrowserLikeFingerprintScripts(ctx, seed);
  return ctx;
}

/**
 * 非持久（一次性 `browser.newContext()`）的统一启动入口：用于 codegen / probe 匿名模式 / 测试。
 *
 * 注意：`launchPersistentContext` 的 launch 选项里 `args/userAgent/viewport/locale/...` 同时承载
 * 「浏览器进程级」和「context 级」配置；非持久路径要拆开传给 `chromium.launch` 与 `browser.newContext`。
 *
 * 返回 `{ browser, context }`，调用方负责关闭：先 `context.close()` 再 `browser.close()`。
 */
export async function launchFingerprintedBrowserContext(args: {
  headless: boolean;
  extraNewContextOptions?: BrowserContextOptions;
  extraLaunchArgs?: string[];
  seedOverride?: string;
  userDataDirFallback?: string;
}): Promise<{ browser: import("playwright").Browser; context: BrowserContext; seed: string }> {
  const seed =
    args.seedOverride && args.seedOverride.trim().length > 0
      ? args.seedOverride.trim()
      : resolveFingerprintSeedFromEnv(process.env, { userDataDirFallback: args.userDataDirFallback });
  const fingerprintOpts = buildBrowserLikePersistentContextOptions(seed) as Record<string, unknown>;
  /**
   * 拆分进程级 vs context 级：
   *   - 进程级（chromium.launch）：headless / args / ignoreDefaultArgs
   *   - context 级（browser.newContext）：userAgent / viewport / locale / timezoneId / colorScheme /
   *     extraHTTPHeaders / deviceScaleFactor / isMobile / hasTouch / reducedMotion / screen
   */
  const launchArgs = (fingerprintOpts.args as string[] | undefined) ?? [];
  const ignoreDefaultArgs = fingerprintOpts.ignoreDefaultArgs as string[] | undefined;
  const browser = await chromium.launch({
    headless: args.headless,
    args: [...launchArgs, ...(args.extraLaunchArgs ?? [])],
    ignoreDefaultArgs,
  });
  const ctxOptions: BrowserContextOptions = {
    userAgent: fingerprintOpts.userAgent as string | undefined,
    viewport: fingerprintOpts.viewport as BrowserContextOptions["viewport"],
    deviceScaleFactor: fingerprintOpts.deviceScaleFactor as number | undefined,
    isMobile: fingerprintOpts.isMobile as boolean | undefined,
    hasTouch: fingerprintOpts.hasTouch as boolean | undefined,
    locale: fingerprintOpts.locale as string | undefined,
    timezoneId: fingerprintOpts.timezoneId as string | undefined,
    colorScheme: fingerprintOpts.colorScheme as BrowserContextOptions["colorScheme"],
    reducedMotion: fingerprintOpts.reducedMotion as BrowserContextOptions["reducedMotion"],
    screen: fingerprintOpts.screen as BrowserContextOptions["screen"],
    extraHTTPHeaders: fingerprintOpts.extraHTTPHeaders as Record<string, string> | undefined,
    ...args.extraNewContextOptions,
  };
  const context = await browser.newContext(ctxOptions);
  await installBrowserLikeFingerprintScripts(context, seed);
  return { browser, context, seed };
}
