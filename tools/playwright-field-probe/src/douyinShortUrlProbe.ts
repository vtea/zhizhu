/**
 * 探测抖音短链 v.douyin.com/xxx 解析结果：最终地址、规范视频 URL、seo/inner/link 中的结构化数据。
 *
 * 用法：
 *   npx tsx src/douyinShortUrlProbe.ts 'https://v.douyin.com/VHNqogjPKw8/'
 *   DOUYIN_PROBE_URL=https://v.douyin.com/xxx npx tsx src/douyinShortUrlProbe.ts
 *
 * 依赖与 probe:anonymous 相同：指纹化 Chromium（headless 默认）。
 */
import type { Browser, BrowserContext } from "playwright";
import { launchFingerprintedBrowserContext } from "@zhizhu/playwright-browser-fingerprint";
import { getBrowserProfileSlug } from "./dirs.js";

const slug = getBrowserProfileSlug();
const startUrl =
  process.argv[2]?.trim() ||
  process.env.DOUYIN_PROBE_URL?.trim() ||
  "https://v.douyin.com/VHNqogjPKw8/";

const headed = process.argv.includes("--headed");
const waitMs = Number(process.env.DOUYIN_PROBE_WAIT_MS ?? "12000");

interface SeoLinkItem {
  link_type?: number;
  link_list?: Array<{ url?: string; anchor?: string }>;
}

function extractVideoIdsFromPageUrl(u: string): string[] {
  const out: string[] = [];
  const mVideo = u.match(/\/video\/(\d+)/);
  if (mVideo) {
    out.push(mVideo[1]!);
  }
  const modal = new URL(u, "https://www.douyin.com").searchParams.get("modal_id");
  if (modal && /^\d+$/.test(modal)) {
    out.push(modal);
  }
  return [...new Set(out)];
}

type VideoLinkEntry = { url: string; link_type: number | null; anchor: string };

function parseSeoInnerLink(json: unknown): {
  videoEntries: VideoLinkEntry[];
  userProfileUrls: string[];
} {
  const videoEntries: VideoLinkEntry[] = [];
  const userProfileUrls: string[] = [];
  const root = json as { link_data?: SeoLinkItem[] };
  const blocks = root.link_data;
  if (!Array.isArray(blocks)) {
    return { videoEntries, userProfileUrls };
  }
  for (const b of blocks) {
    const lt = typeof b.link_type === "number" ? b.link_type : null;
    const lists = b.link_list;
    if (!Array.isArray(lists)) {
      continue;
    }
    for (const item of lists) {
      const u = item.url?.trim();
      if (!u) {
        continue;
      }
      if (/\/video\/\d+/.test(u)) {
        videoEntries.push({
          url: u.split("?")[0]!,
          link_type: lt,
          anchor: item.anchor?.trim() ?? "",
        });
      }
      if (/\/user\/MS4wLjAB[^/?]+/.test(u) || /\/user\/[^/]+/.test(u)) {
        userProfileUrls.push(u.split("?")[0]!);
      }
    }
  }
  return {
    videoEntries,
    userProfileUrls: [...new Set(userProfileUrls)],
  };
}

let browser: Browser | undefined;
let context: BrowserContext;

const launched = await launchFingerprintedBrowserContext({
  headless: !headed,
  seedOverride: `douyin-short-probe:${slug}`,
});
browser = launched.browser;
context = launched.context;

const page = context.pages()[0] ?? (await context.newPage());

let seoBody: string | null = null;
let seoUrl: string | null = null;

page.on("response", async (response) => {
  const u = response.url();
  if (!u.includes("/aweme/v1/web/seo/inner/link")) {
    return;
  }
  try {
    const ct = (response.headers()["content-type"] ?? "").toLowerCase();
    if (!ct.includes("json")) {
      return;
    }
    const text = await response.text();
    if (text.length > 0 && text.length < 2_000_000) {
      seoUrl = u;
      seoBody = text;
    }
  } catch {
    /* ignore */
  }
});

console.log(`\n【Douyin 短链探测】profile=${slug} headless=${!headed}`);
console.log(`起始: ${startUrl}\n`);

try {
  await page.goto(startUrl, { waitUntil: "domcontentloaded", timeout: 120_000 });
} catch (e) {
  console.warn("goto 告警:", e instanceof Error ? e.message : e);
}

await new Promise((r) => setTimeout(r, Number.isFinite(waitMs) ? waitMs : 12_000));

const finalUrl = page.url();
console.log("【导航后 page.url】");
console.log(finalUrl);

const fromLocation = extractVideoIdsFromPageUrl(finalUrl);
console.log("\n【从地址栏解析的 dy_video_id / modal_id】");
console.log(fromLocation.length ? fromLocation.join(", ") : "(无，可能落在用户页或未带 video 段)");

console.log("\n【规范视频页（推荐存 dy_video_url）】");
if (fromLocation.length) {
  for (const id of fromLocation) {
    console.log(`  https://www.douyin.com/video/${id}`);
  }
}

if (seoBody) {
  try {
    const j = JSON.parse(seoBody) as unknown;
    const parsed = parseSeoInnerLink(j);
    console.log("\n【XHR: seo/inner/link】");
    console.log(`  请求: ${seoUrl}`);
    console.log("  每条视频链（link_type + anchor，便于区分「当前分享」与推荐池）:");
    const seen = new Set<string>();
    for (const e of parsed.videoEntries) {
      const key = `${e.link_type ?? "?"}|${e.url}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      const id = e.url.match(/\/video\/(\d+)/)?.[1] ?? "?";
      const anch = e.anchor ? `  anchor=${e.anchor.slice(0, 100)}${e.anchor.length > 100 ? "…" : ""}` : "";
      console.log(`    link_type=${e.link_type ?? "null"}  dy_video_id=${id}${anch}`);
      console.log(`      ${e.url}`);
    }
    const primary760 = parsed.videoEntries.find((e) => e.link_type === 760);
    if (primary760) {
      console.log("\n  【候选】link_type=760 在部分响应中表示「当前分享」视频（以线上为准）:");
      console.log(`    ${primary760.url}`);
    }
    if (parsed.userProfileUrls.length) {
      console.log("  同包内用户主页候选:");
      for (const u of parsed.userProfileUrls.slice(0, 5)) {
        console.log(`    ${u}`);
      }
    }
  } catch (e) {
    console.warn("  解析 seo/inner/link JSON 失败:", e);
  }
} else {
  console.log("\n【XHR: seo/inner/link】未捕获（可加大 DOUYIN_PROBE_WAIT_MS 或改用 --headed）");
}

console.log(`
【数据从哪来】
1) 短链真实跳转：以 Playwright page.url() 为准（可能到用户页 + 弹层，query 里或有 modal_id）。
2) 稳定主键 dy_video_id：优先从 https://www.douyin.com/video/{id} 路径取数字 id；与数据字典 §2.1 一致。
3) 分享落地常请求 GET .../aweme/v1/web/seo/inner/link/...，响应 link_data[].link_list[].url 中含规范 /video/{id}；
   同包内常混有推荐视频，请结合 link_type 与 anchor 选行（见 docs/Playwright字段定位清单.md §7.1）。
4) 标题/发布时间/赞评藏转/播放/封面：打开视频页后抓 .../aweme/v1/web/aweme/detail/...；
   与自动化规则 captureResponse+json_path 的对照表见 docs/Playwright字段定位清单.md §7.1。
`);

if (browser) {
  await browser.close();
} else {
  await context.close();
}
