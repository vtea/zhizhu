/**
 * 子路由无匹配时不得侧栏有、主区域空白；应重定向到租户首页或子模块默认页。
 */
import { expect, test } from "@playwright/test";

test.describe("知竹 Web：无匹配子路径", () => {
  test("未定义路径重定向到数据大盘并可见 h1", async ({ page }) => {
    await page.goto("/login", { waitUntil: "load" });
    await page.getByLabel("租户 ID", { exact: true }).fill("demo");
    await page.getByLabel("用户名或邮箱", { exact: true }).fill("admin");
    await page.getByLabel("密码", { exact: true }).fill("A123456");
    await page.getByRole("button", { name: "登录" }).click();
    await expect(page).toHaveURL(/\/t\/demo\/dashboard/);

    await page.goto("/t/demo/__e2e_no_such_path__", { waitUntil: "load" });
    await expect(page).toHaveURL(/\/t\/demo\/dashboard/);
    await expect(page.getByRole("heading", { name: "数据大盘" })).toBeVisible();
  });
});
