/**
 * 平台：租户管理页应包含「登记租户」表单与列表（不强制断言 POST 成功：本地须重启 @zhizhu/api 以加载新路由，否则会 404）。
 */
import { expect, test } from "@playwright/test";

test.describe("知竹 Web：平台租户管理", () => {
  test("存在登记新租户入口与数据表", async ({ page }) => {
    await page.goto("/login", { waitUntil: "load" });
    await page.getByLabel("租户 ID", { exact: true }).fill("vtea");
    await page.getByLabel("用户名或邮箱", { exact: true }).fill("vtea");
    await page.getByLabel("密码", { exact: true }).fill("A123456");
    await page.getByRole("button", { name: "登录" }).click();
    await expect(page).toHaveURL(/tenant-management/);
    await expect(page.getByRole("heading", { name: "租户管理" })).toBeVisible();
    await expect(page.getByRole("button", { name: "新建租户登记" })).toBeVisible();
    await expect(page.getByRole("table")).toBeVisible();

    await page.getByRole("button", { name: "新建租户登记" }).click();
    await expect(page.getByRole("heading", { name: "登记新租户" })).toBeVisible();
    await expect(page.getByPlaceholder(/例如 nawan/)).toBeVisible();
    await expect(page.getByRole("button", { name: "确认登记" })).toBeVisible();
  });
});
