import assert from "node:assert/strict";
import { test } from "node:test";
import { chromium } from "playwright";

import {
  clickErrorSuggestsPointerIntercept,
  dismissLeadsOverlays,
} from "./dismissLeadsOverlays";

test("clickErrorSuggestsPointerIntercept: 识别 pointer 被挡", () => {
  assert.equal(
    clickErrorSuggestsPointerIntercept(new Error("athena-survey-widget intercepts pointer events")),
    true,
  );
  assert.equal(clickErrorSuggestsPointerIntercept(new Error("Timeout 60000ms exceeded")), false);
});

test("dismissLeadsOverlays: 移除 widget 后可点击下层按钮", async () => {
  // allow-raw-launch: 单元测试仅 setContent 本地 HTML fixture，不访问业务域，无需指纹
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <div class="athena-survey-widget" style="position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.2)">
        survey
      </div>
      <button id="target" style="margin-top:200px">50条/页</button>
    `);
    const target = page.locator("#target");
    let blocked = false;
    try {
      await target.click({ timeout: 2000 });
    } catch (e) {
      blocked = clickErrorSuggestsPointerIntercept(e);
    }
    assert.equal(blocked, true, "widget 应挡住普通 click");

    await dismissLeadsOverlays(page);
    assert.equal(await page.locator(".athena-survey-widget").count(), 0);
    await target.click({ timeout: 2000 });
  } finally {
    await browser.close();
  }
});
