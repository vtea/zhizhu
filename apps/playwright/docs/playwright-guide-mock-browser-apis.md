---
title: 模拟浏览器 API
source_url: https://playwright.nodejs.cn/docs/mock-browser-apis
fetched_at: 2026-04-29T02:57:28.664Z
---

# 模拟浏览器 API

🌐 Introduction

Playwright 对大多数浏览器功能提供了原生支持。然而，也有一些实验性 API 以及尚未被所有浏览器完全支持的 API。在这种情况下，Playwright 通常不会提供专门的自动化 API。你可以使用模拟来测试应用在这种情况下的行为。本指南提供了一些示例。

🌐 Playwright provides native support for most of the browser features. However, there are some experimental APIs and APIs which are not (yet) fully supported by all browsers. Playwright usually doesn't provide dedicated automation APIs in such cases. You can use mocks to test the behavior of your application in such cases. This guide gives a few examples.

让我们考虑一个使用[battery API](https://web.nodejs.cn/en-US/docs/Web/API/Navigator/getBattery)来显示设备电池状态的网页应用。我们将模拟电池 API，并检查页面是否正确显示电池状态。

🌐 Let's consider a web app that uses [battery API](https://web.nodejs.cn/en-US/docs/Web/API/Navigator/getBattery) to show your device's battery status. We'll mock the battery API and check that the page correctly displays the battery status.

## 创建模拟

🌐 Creating mocks

由于页面在加载时可能会非常早地调用 API，因此在页面开始加载之前设置所有模拟非常重要。实现这一点最简单的方法是调用 [page.addInitScript()](https://playwright.nodejs.cn/docs/api/class-page#page-add-init-script)：

🌐 Since the page may be calling the API very early while loading it's important to setup all the mocks before the page started loading. The easiest way to achieve that is to call [page.addInitScript()](https://playwright.nodejs.cn/docs/api/class-page#page-add-init-script):

```ts
await page.addInitScript(() => {
  const mockBattery = {
  level: 0.75,    charging: true,    chargingTime: 1800,    dischargingTime: Infinity,    addEventListener: () => { }  };  // Override the method to always return mock battery info.  window.navigator.getBattery = async () => mockBattery;
});
```

完成此操作后，你可以导航页面并检查其 UI 状态：

🌐 Once this is done you can navigate the page and check its UI state:

```ts
// Configure mock API before each test.test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
  const mockBattery = {
  level: 0.90,      charging: true,      chargingTime: 1800, // seconds      dischargingTime: Infinity,      addEventListener: () => { }    };    // Override the method to always return mock battery info.    window.navigator.getBattery = async () => mockBattery;  });
});
test('show battery status', async ({ page }) => {
  await page.goto('/');  await expect(page.locator('.battery-percentage')).toHaveText('90%');  await expect(page.locator('.battery-status')).toHaveText('Adapter');  await expect(page.locator('.battery-fully')).toHaveText('00:30');
});
```

## 模拟只读 API

🌐 Mocking read-only APIs

有些 API 是只读的，因此你无法给 navigator 属性赋值。例如，

🌐 Some APIs are read-only so you won't be able to assign to a navigator property. For example,

```
// Following line will have no effect.navigator.cookieEnabled = true;
```

但是，如果该属性是 [可配置的](https://web.nodejs.cn/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/defineProperty#configurable)，你仍然可以使用普通的 JavaScript 来覆盖它：

🌐 However, if the property is [configurable](https://web.nodejs.cn/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/defineProperty#configurable), you can still override it using the plain JavaScript:

```ts
await page.addInitScript(() => {
  Object.defineProperty(Object.getPrototypeOf(navigator), 'cookieEnabled', { value: false });
});
```

## 验证 API 调用

🌐 Verifying API calls

有时检查页面是否进行了所有预期的 API 调用是很有用的。你可以记录所有的 API 方法调用，然后将它们与标准结果进行比较。[page.exposeFunction()](https://playwright.nodejs.cn/docs/api/class-page#page-expose-function) 可能对将消息从页面传回测试代码非常有用：

🌐 Sometimes it is useful to check if the page made all expected APIs calls. You can record all API method invocations and then compare them with golden result. [page.exposeFunction()](https://playwright.nodejs.cn/docs/api/class-page#page-expose-function) may come in handy for passing message from the page back to the test code:

```ts
test('log battery calls', async ({ page }) => {
  const log = [];  // Expose function for pushing messages to the Node.js script.  await page.exposeFunction('logCall', msg => log.push(msg));  await page.addInitScript(() => {
  const mockBattery = {
  level: 0.75,      charging: true,      chargingTime: 1800,      dischargingTime: Infinity,      // Log addEventListener calls.      addEventListener: (name, cb) => logCall(`addEventListener:${name}`)    };    // Override the method to always return mock battery info.    window.navigator.getBattery = async () => {
  logCall('getBattery');      return mockBattery;    };  });  await page.goto('/');  await expect(page.locator('.battery-percentage')).toHaveText('75%');  // Compare actual calls with golden.  expect(log).toEqual([    'getBattery',    'addEventListener:chargingchange',    'addEventListener:levelchange'  ]);
});
```

## 更新模拟

🌐 Updating mock

为了测试应用是否正确反映电池状态更新，确保模拟电池对象触发与浏览器实现相同的事件非常重要。以下测试演示了如何实现这一点：

🌐 To test that the app correctly reflects battery status updates it's important to make sure that the mock battery object fires same events that the browser implementation would. The following test demonstrates how to achieve that:

```ts
test('update battery status (no golden)', async ({ page }) => {
  await page.addInitScript(() => {
  // Mock class that will notify corresponding listeners when battery status changes.    class BatteryMock {
  level = 0.10;      charging = false;      chargingTime = 1800;      dischargingTime = Infinity;      _chargingListeners = [];      _levelListeners = [];      addEventListener(eventName, listener) {
  if (eventName === 'chargingchange')          this._chargingListeners.push(listener);        if (eventName === 'levelchange')          this._levelListeners.push(listener);      }      // Will be called by the test.      _setLevel(value) {
  this.level = value;        this._levelListeners.forEach(cb => cb());      }      _setCharging(value) {
  this.charging = value;        this._chargingListeners.forEach(cb => cb());      }    }    const mockBattery = new BatteryMock();    // Override the method to always return mock battery info.    window.navigator.getBattery = async () => mockBattery;    // Save the mock object on window for easier access.    window.mockBattery = mockBattery;  });  await page.goto('/');  await expect(page.locator('.battery-percentage')).toHaveText('10%');  // Update level to 27.5%  await page.evaluate(() => window.mockBattery._setLevel(0.275));  await expect(page.locator('.battery-percentage')).toHaveText('27.5%');  await expect(page.locator('.battery-status')).toHaveText('Battery');  // Emulate connected adapter  await page.evaluate(() => window.mockBattery._setCharging(true));  await expect(page.locator('.battery-status')).toHaveText('Adapter');  await expect(page.locator('.battery-fully')).toHaveText('00:30');
});
```
