/**
 * 以 demo 租户登录后，尽可能覆盖主控制台路由；每页用 PageHeader 的 h1 做「非白屏」验收。
 * 与 business 深交互（建删改、复杂表单项）在后续专项用例中扩展；此处优先发现路由/挂死/重复 Navigate 类问题。
 */
import { expect, test } from "@playwright/test";

const DEMO_LOGIN = {
  tenant: "demo",
  user: "admin",
  password: "A123456",
} as const;

const ROUTE_HEADING: { path: string; heading: string }[] = [
  { path: "/t/demo/dashboard", heading: "数据大盘" },
  { path: "/t/demo/staff-accounts", heading: "员工账号管理" },
  { path: "/t/demo/automation-rules", heading: "自动化规则" },
  { path: "/t/demo/leads", heading: "线索管理" },
  { path: "/t/demo/videos", heading: "视频管理" },
  { path: "/t/demo/recommended-videos", heading: "推荐视频" },
  { path: "/t/demo/ad-placements", heading: "投放管理" },
  { path: "/t/demo/device-binding", heading: "设备绑定" },
  { path: "/t/demo/system-settings/organization", heading: "组织与成员" },
  { path: "/t/demo/system-settings/tasks", heading: "任务中心" },
  { path: "/t/demo/system-settings/access", heading: "访问控制" },
  { path: "/t/demo/system-settings/audit", heading: "审计与导出" },
  // 邮件（SMTP）仅 platform_admin 可见，见 02-* 平台管理员用例，不在 demo 租户下验收
  // 与 SystemSettings 平级、避免漏掉只挂侧栏的「系统设置」总览
  { path: "/t/demo/system-settings", heading: "系统设置" },
];

test.describe("知竹 Web：demo 控制台多路由", () => {
  test("登录后主路由 h1 均可见（表面验收）", async ({ page }) => {
    await page.goto("/login", { waitUntil: "load" });
    await page.getByLabel("租户 ID", { exact: true }).fill(DEMO_LOGIN.tenant);
    await page.getByLabel("用户名或邮箱", { exact: true }).fill(DEMO_LOGIN.user);
    await page.getByLabel("密码", { exact: true }).fill(DEMO_LOGIN.password);
    await page.getByRole("button", { name: "登录" }).click();
    await expect(page).toHaveURL(/\/t\/demo\/dashboard/);

    for (const { path, heading } of ROUTE_HEADING) {
      await test.step(`打开 ${path}`, async () => {
        await page.goto(path, { waitUntil: "load" });
        const h = page.getByRole("heading", { name: heading, exact: true });
        await expect(h).toBeVisible({ timeout: 25_000 });
      });
    }
  });

  test("主菜单侧栏点击与 URL、主标题一致（防 NavLink/tenant 前缀错误）", async ({ page }) => {
    await page.goto("/login", { waitUntil: "load" });
    await page.getByLabel("租户 ID", { exact: true }).fill(DEMO_LOGIN.tenant);
    await page.getByLabel("用户名或邮箱", { exact: true }).fill(DEMO_LOGIN.user);
    await page.getByLabel("密码", { exact: true }).fill(DEMO_LOGIN.password);
    await page.getByRole("button", { name: "登录" }).click();
    await expect(page).toHaveURL(/\/t\/demo\/dashboard/);

    const main = page.getByLabel("主菜单");
    await main.getByRole("link", { name: "线索管理" }).click();
    await expect(page).toHaveURL(/\/t\/demo\/leads/);
    await expect(page.getByRole("heading", { name: "线索管理", exact: true })).toBeVisible();

    await main.getByRole("link", { name: "系统设置" }).click();
    await expect(page).toHaveURL(/\/t\/demo\/system-settings/);
    await expect(page.getByRole("heading", { name: "系统设置", exact: true })).toBeVisible();

    await main.getByRole("link", { name: "设备绑定" }).click();
    await expect(page).toHaveURL(/\/t\/demo\/device-binding/);
    await expect(page.getByRole("heading", { name: "设备绑定", exact: true })).toBeVisible();
  });
});
