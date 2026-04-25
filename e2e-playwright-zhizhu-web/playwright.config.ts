import { defineConfig, devices } from "@playwright/test";

const chrome = { ...devices["Desktop Chrome"] };

const e2eBase = process.env.WEB_BASE_URL?.replace(/\/$/, "").trim();

/**
 * 仅测一种页面入口时设置 WEB_BASE_URL；否则默认用两个 project（CORS/同源验收）。
 * 用例在 ./specs/ 下，勿与 `tools/playwright-field-probe` 混淆。
 */
export default defineConfig({
  testDir: "specs",
  testMatch: "**/*.spec.ts",
  testIgnore: /\/\._|^\._/,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  use: { trace: "on-first-retry" },
  timeout: 40_000,
  expect: { timeout: 25_000 },
  projects: e2eBase
    ? [
        {
          name: "chromium-custom",
          use: { ...chrome, baseURL: e2eBase },
        },
      ]
    : [
        { name: "chromium-127", use: { ...chrome, baseURL: "http://127.0.0.1:5173" } },
        { name: "chromium-localhost", use: { ...chrome, baseURL: "http://localhost:5173" } },
      ],
});
