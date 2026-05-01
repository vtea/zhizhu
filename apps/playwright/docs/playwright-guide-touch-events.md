---
title: 触摸事件（旧版）
source_url: https://playwright.nodejs.cn/docs/touch-events
fetched_at: 2026-04-29T02:57:28.664Z
---

# 触摸事件（旧版）

## 介绍

🌐 Introduction

处理传统 [触摸事件](https://web.nodejs.cn/en-US/docs/Web/API/Touch_events) 以响应滑动、捏合和点击等手势的网页应用，可以通过手动向页面派发 [TouchEvent](https://web.nodejs.cn/en-US/docs/Web/API/TouchEvent/TouchEvent) 来进行测试。下面的示例演示了如何使用 [locator.dispatchEvent()](https://playwright.nodejs.cn/docs/api/class-locator#locator-dispatch-event) 并传递 [Touch](https://web.nodejs.cn/en-US/docs/Web/API/Touch) 点作为参数。

🌐 Web applications that handle legacy [touch events](https://web.nodejs.cn/en-US/docs/Web/API/Touch_events) to respond to gestures like swipe, pinch, and tap can be tested by manually dispatching [TouchEvent](https://web.nodejs.cn/en-US/docs/Web/API/TouchEvent/TouchEvent)s to the page. The examples below demonstrate how to use [locator.dispatchEvent()](https://playwright.nodejs.cn/docs/api/class-locator#locator-dispatch-event) and pass [Touch](https://web.nodejs.cn/en-US/docs/Web/API/Touch) points as arguments.

请注意，[locator.dispatchEvent()](https://playwright.nodejs.cn/docs/api/class-locator#locator-dispatch-event) 不会设置 [`Event.isTrusted`](https://web.nodejs.cn/en-US/docs/Web/API/Event/isTrusted) 属性。如果你的网页依赖于它，请确保在测试期间禁用 `isTrusted` 检查。

🌐 Note that [locator.dispatchEvent()](https://playwright.nodejs.cn/docs/api/class-locator#locator-dispatch-event) does not set [`Event.isTrusted`](https://web.nodejs.cn/en-US/docs/Web/API/Event/isTrusted) property. If your web page relies on it, make sure to disable `isTrusted` check during the test.

### 模拟平移手势

🌐 Emulating pan gesture

在下面的示例中，我们模拟了预期用于移动地图的平移手势。被测试的应用只使用触点的 `clientX/clientY` 坐标，因此我们仅初始化该坐标。在更复杂的场景中，如果应用需要，你可能还需要设置 `pageX/pageY/screenX/screenY`。

🌐 In the example below, we emulate pan gesture that is expected to move the map. The app under test only uses `clientX/clientY` coordinates of the touch point, so we initialize just that. In a more complex scenario you may need to also set `pageX/pageY/screenX/screenY`, if your app needs them.

```ts
import { test, expect, devices, type Locator } from '@playwright/test';
test.use({ ...devices['Pixel 7'] });
async function pan(locator: Locator, deltaX?: number, deltaY?: number, steps?: number) {
  const { centerX, centerY } = await locator.evaluate((target: HTMLElement) => {
  const bounds = target.getBoundingClientRect();    const centerX = bounds.left + bounds.width / 2;    const centerY = bounds.top + bounds.height / 2;    return { centerX, centerY };  });  // Providing only clientX and clientY as the app only cares about those.  const touches = [{
  identifier: 0,    clientX: centerX,    clientY: centerY,  }];  await locator.dispatchEvent('touchstart',      { touches, changedTouches: touches, targetTouches: touches });  steps = steps ?? 5;  deltaX = deltaX ?? 0;  deltaY = deltaY ?? 0;  for (let i = 1; i <= steps; i++) {
  const touches = [{
  identifier: 0,      clientX: centerX + deltaX * i / steps,      clientY: centerY + deltaY * i / steps,    }];    await locator.dispatchEvent('touchmove',        { touches, changedTouches: touches, targetTouches: touches });  }  await locator.dispatchEvent('touchend');
}test(`pan gesture to move the map`, async ({ page }) => {
  await page.goto('https://www.google.com/maps/place/@37.4117722,-122.0713234,15z',      { waitUntil: 'commit' });  await page.getByRole('button', { name: 'Keep using web' }).click();  await expect(page.getByRole('button', { name: 'Keep using web' })).not.toBeVisible();  // Get the map element.  const met = page.locator('[data-test-id="met"]');  for (let i = 0; i < 5; i++)    await pan(met, 200, 100);  // Ensure the map has been moved.  await expect(met).toHaveScreenshot();
});
```

### 模拟捏合手势

🌐 Emulating pinch gesture

在下面的示例中，我们模拟捏合手势，即两个触点互相靠近。预期效果是地图缩小。被测试的应用只使用触点的 `clientX/clientY` 坐标，因此我们只初始化了该坐标。在更复杂的场景中，如果应用需要，你可能还需要设置 `pageX/pageY/screenX/screenY`。

🌐 In the example below, we emulate pinch gesture, i.e. two touch points moving closer to each other. It is expected to zoom out the map. The app under test only uses `clientX/clientY` coordinates of touch points, so we initialize just that. In a more complex scenario you may need to also set `pageX/pageY/screenX/screenY`, if your app needs them.

```json
import { test, expect, devices, type Locator } from '@playwright/test';test.use({ ...devices['Pixel 7'] });async function pinch(locator: Locator,  arg: { deltaX?: number, deltaY?: number, steps?: number, direction?: 'in' | 'out' }) {  const { centerX, centerY } = await locator.evaluate((target: HTMLElement) => {    const bounds = target.getBoundingClientRect();    const centerX = bounds.left + bounds.width / 2;    const centerY = bounds.top + bounds.height / 2;    return { centerX, centerY };  });  const deltaX = arg.deltaX ?? 50;  const steps = arg.steps ?? 5;  const stepDeltaX = deltaX / (steps + 1);  // Two touch points equally distant from the center of the element.  const touches = [    {      identifier: 0,      clientX: centerX - (arg.direction === 'in' ? deltaX : stepDeltaX),      clientY: centerY,    },    {      identifier: 1,      clientX: centerX + (arg.direction === 'in' ? deltaX : stepDeltaX),      clientY: centerY,    },  ];  await locator.dispatchEvent('touchstart',      { touches, changedTouches: touches, targetTouches: touches });  // Move the touch points towards or away from each other.  for (let i = 1; i <= steps; i++) {    const offset = (arg.direction === 'in' ? (deltaX - i * stepDeltaX) : (stepDeltaX * (i + 1)));    const touches = [      {        identifier: 0,        clientX: centerX - offset,        clientY: centerY,      },      {        identifier: 0,        clientX: centerX + offset,        clientY: centerY,      },    ];    await locator.dispatchEvent('touchmove',        { touches, changedTouches: touches, targetTouches: touches });  }  await locator.dispatchEvent('touchend', { touches: [], changedTouches: [], targetTouches: [] });}test(`pinch in gesture to zoom out the map`, async ({ page }) => {  await page.goto('https://www.google.com/maps/place/@37.4117722,-122.0713234,15z',      { waitUntil: 'commit' });  await page.getByRole('button', { name: 'Keep using web' }).click();  await expect(page.getByRole('button', { name: 'Keep using web' })).not.toBeVisible();  // Get the map element.  const met = page.locator('[data-test-id="met"]');  for (let i = 0; i < 5; i++)    await pinch(met, { deltaX: 40, direction: 'in' });  // Ensure the map has been zoomed out.  await expect(met).toHaveScreenshot();});
```
