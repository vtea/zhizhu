/**
 * 登录后内页：用主标题 h1 断言页面已挂载（非仅 URL），覆盖多路由避免白屏回归。
 * 与 tools/playwright-field-probe 无关。
 */
import { expect, test } from "@playwright/test";

async function loginDemoAdmin(page: import("@playwright/test").Page) {
  await page.goto("/login", { waitUntil: "load" });
  await page.getByLabel("租户 ID", { exact: true }).fill("demo");
  await page.getByLabel("用户名或邮箱", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("A123456");
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).toHaveURL(/\/t\/demo\/dashboard/);
  await expect(page.getByRole("heading", { name: "数据大盘" })).toBeVisible({ timeout: 20_000 });
}

test.describe("知竹 Web：demo 登录后内页", () => {
  test("数据大盘、员工账号、线索、系统设置-组织 可打开且主标题可见", async ({ page }) => {
    await loginDemoAdmin(page);

    await page.goto("/t/demo/staff-accounts", { waitUntil: "load" });
    await expect(page.getByRole("heading", { name: "员工账号管理" })).toBeVisible({ timeout: 20_000 });

    await page.goto("/t/demo/leads", { waitUntil: "load" });
    await expect(page.getByRole("heading", { name: "线索管理" })).toBeVisible({ timeout: 20_000 });

    await page.goto("/t/demo/system-settings/organization", { waitUntil: "load" });
    await expect(page.getByRole("heading", { name: "组织与成员" })).toBeVisible({ timeout: 20_000 });
  });

  test("系统设置-邮件（SMTP）对租户用户不可见：重定向到组织", async ({ page }) => {
    await loginDemoAdmin(page);
    await page.goto("/t/demo/system-settings/mail", { waitUntil: "load" });
    await expect(page).toHaveURL(/\/t\/demo\/system-settings\/organization/);
    await expect(page.getByRole("heading", { name: "组织与成员", exact: true })).toBeVisible({ timeout: 20_000 });
  });
});

test.describe("知竹 Web：平台管理员登录后内页", () => {
  test("可切到业务租户 demo 并打开数据大盘", async ({ page }) => {
    await page.goto("/login", { waitUntil: "load" });
    await page.getByLabel("租户 ID", { exact: true }).fill("zhizhuplatform");
    await page.getByLabel("用户名或邮箱", { exact: true }).fill("platform-admin");
    await page.getByLabel("密码", { exact: true }).fill("A123456");
    await page.getByRole("button", { name: "登录" }).click();
    await expect(page).toHaveURL(/\/t\/.*\/tenant-management/);
    await expect(page.getByRole("heading", { name: "租户管理" })).toBeVisible({ timeout: 20_000 });

    await page.goto("/t/demo/dashboard", { waitUntil: "load" });
    await expect(page.getByRole("heading", { name: "数据大盘" })).toBeVisible({ timeout: 20_000 });
  });

  test("系统设置-邮件（SMTP）对平台管理员可见（全站发信配置）", async ({ page }) => {
    await page.goto("/login", { waitUntil: "load" });
    await page.getByLabel("租户 ID", { exact: true }).fill("zhizhuplatform");
    await page.getByLabel("用户名或邮箱", { exact: true }).fill("platform-admin");
    await page.getByLabel("密码", { exact: true }).fill("A123456");
    await page.getByRole("button", { name: "登录" }).click();
    await expect(page).toHaveURL(/\/t\/.*\/tenant-management/);

    await page.goto("/t/demo/system-settings/mail", { waitUntil: "load" });
    await expect(page.getByRole("heading", { name: "邮件（SMTP）", exact: true })).toBeVisible({ timeout: 20_000 });
  });
});
