/**
 * 知竹 Web：控制台 登录 + 注册（真机 Chromium）
 * 与 tools/playwright-field-probe 无关。前置：见 ../README.md
 */
import { expect, test } from "@playwright/test";

test.describe("知竹 Web：登录", () => {
  test("租户 admin 可登录到 demo 数据大盘", async ({ page }) => {
    await page.goto("/login", { waitUntil: "load" });
    await page.getByLabel("租户 ID", { exact: true }).fill("demo");
    await page.getByLabel("用户名或邮箱", { exact: true }).fill("admin");
    await page.getByLabel("密码", { exact: true }).fill("A123456");
    await page.getByRole("button", { name: "登录" }).click();
    await expect(page).toHaveURL(/\/t\/demo\/dashboard/);
    await expect(page.getByRole("heading", { name: "数据大盘" })).toBeVisible({ timeout: 20_000 });
  });

  test("平台管理员可进入租户管理并看到页面（非白屏）", async ({ page }) => {
    await page.goto("/login", { waitUntil: "load" });
    await page.getByLabel("租户 ID", { exact: true }).fill("zhizhuplatform");
    await page.getByLabel("用户名或邮箱", { exact: true }).fill("platform-admin");
    await page.getByLabel("密码", { exact: true }).fill("A123456");
    await page.getByRole("button", { name: "登录" }).click();
    await expect(page).toHaveURL(/(\/t\/.*\/tenant-management|\/platform\/tenants)/);
    // 与「只断言 URL」不同：必须能挂载出租户管理主标题，避免同路径 Navigate 死循环等导致白屏
    await expect(page.getByRole("heading", { name: "租户管理" })).toBeVisible({
      timeout: 15_000,
    });
  });
});

test.describe("知竹 Web：注册", () => {
  test("可提交新用户并回到登录", async ({ page }) => {
    const u = `e2e${Date.now()}${Math.random().toString(36).slice(2, 10)}`
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, "x")
      .slice(0, 32);
    const em = `${u}@e2e.local.test`;
    await page.goto("/register", { waitUntil: "load" });
    await expect(page.getByRole("heading", { name: "注册控制台用户" })).toBeVisible();
    await page.getByLabel("租户 ID", { exact: true }).fill("demo");
    await page.getByPlaceholder(/位小写，字母或数字开头/).fill(u);
    await page.getByLabel("邮箱", { exact: true }).fill(em);
    await page.locator('input[autocomplete="new-password"]').fill("E2E12345!");
    await page.getByRole("button", { name: "注册" }).click();
    await expect(page).toHaveURL("/login", { timeout: 15_000 });
  });
});
