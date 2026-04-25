/**
 * 从登录态持久化 profile 拉取完整 `/bff/user/routes`，打印菜单 `menu_key` + `name` 供填 §1 URL。
 * 不写入仓库；仅 stdout。
 *
 *   PLAYWRIGHT_BROWSER_PROFILE=jiacheng-guoji npx tsx src/dump-menu-keys.ts
 */
import { launchPersistentProfileContext } from "./persistentProfileLaunch.js";
import { getBrowserProfileSlug, getPersistentProfileDir } from "./dirs.js";

type MenuNode = {
  menu_key?: string;
  name?: string;
  action_value?: string;
  content?: string;
  sub_menu?: MenuNode[];
};

function walk(nodes: MenuNode[] | undefined, prefix: string[]): void {
  if (!Array.isArray(nodes)) return;
  for (const n of nodes) {
    const key = n.menu_key ?? "";
    const name = n.name ?? "";
    const trail = [...prefix, name].filter(Boolean).join(" > ");
    const av = (n.action_value ?? "").trim();
    if (key || name) {
      const line = [key, name, av ? `action_value=${av.slice(0, 100)}` : ""]
        .filter(Boolean)
        .join("\t");
      console.log(line + (trail ? `\t# ${trail}` : ""));
    }
    if (n.sub_menu?.length) walk(n.sub_menu, [...prefix, name || key]);
  }
}

const slug = getBrowserProfileSlug();
const dir = getPersistentProfileDir(slug);
const context = await launchPersistentProfileContext(dir, slug, { headless: true });
try {
  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto("https://leads.cluerich.com/pc/growth/home", {
    waitUntil: "domcontentloaded",
    timeout: 120_000,
  });
  const resp = await context.request.get("https://leads.cluerich.com/bff/user/routes");
  const text = await resp.text();
  const d = JSON.parse(text) as {
    data?: { menuConfig?: { menu?: { sub_menu?: MenuNode[] } } };
  };
  const root = d?.data?.menuConfig?.menu?.sub_menu;
  console.log(`\n# profile=${slug} status=${resp.status()} menu rows:\n`);
  walk(root, []);

  const pc = new Set<string>();
  for (const m of text.matchAll(/"(\/pc\/[^"]+)"/g)) pc.add(m[1]!);
  console.log("\n# literal /pc/... strings in routes JSON (for §1 URL):\n");
  console.log([...pc].sort().join("\n"));
} finally {
  await context.close();
}
