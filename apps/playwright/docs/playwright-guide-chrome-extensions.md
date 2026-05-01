---
title: Chrome 扩展程序
source_url: https://playwright.nodejs.cn/docs/chrome-extensions
fetched_at: 2026-04-29T02:57:28.664Z
---

# Chrome 扩展程序

🌐 Introduction

note

扩展程序只有在使用持久上下文启动时才能在 Chromium 中工作。自行使用自定义浏览器参数需谨慎，因为某些参数可能会破坏 Playwright 的功能。

🌐 Extensions only work in Chromium when launched with a persistent context. Use custom browser args at your own risk, as some of them may break Playwright functionality.

Google Chrome 和 Microsoft Edge [移除了侧载扩展所需的命令行标志](https://groups.google.com/a/chromium.org/g/chromium-extensions/c/FxMU1TvxWWg/m/daZVTYNlBQAJ)，因此请使用随 Playwright 打包的 Chromium。:::

🌐 Google Chrome and Microsoft Edge [removed the command-line flags needed to side-load extensions](https://groups.google.com/a/chromium.org/g/chromium-extensions/c/FxMU1TvxWWg/m/daZVTYNlBQAJ), so use Chromium that comes bundled with Playwright.

下面的代码片段检索位于 `./my-extension` 的 [Manifest v3](https://developer.chrome.com/docs/extensions/develop/migrate) 扩展的 [服务工作进程](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers)。

🌐 The snippet below retrieves the [service worker](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers) of a [Manifest v3](https://developer.chrome.com/docs/extensions/develop/migrate) extension whose source is located in `./my-extension`.

注意使用 `chromium` 通道，这允许以无头模式运行扩展程序。或者，你也可以以有头模式启动浏览器。

🌐 Note the use of the `chromium` channel that allows to run extensions in headless mode. Alternatively, you can launch the browser in headed mode.

```json
const { chromium } = require('playwright');(async () => {  const pathToExtension = require('path').join(__dirname, 'my-extension');  const userDataDir = '/tmp/test-user-data-dir';  const browserContext = await chromium.launchPersistentContext(userDataDir, {    channel: 'chromium',    args: [      `--disable-extensions-except=${pathToExtension}`,      `--load-extension=${pathToExtension}`    ]  });  let [serviceWorker] = browserContext.serviceWorkers();  if (!serviceWorker)    serviceWorker = await browserContext.waitForEvent('serviceworker');  // Test the service worker as you would any other worker.  await browserContext.close();})();
```

## 测试

🌐 Testing

在运行测试时要加载扩展程序，可以使用测试夹具来设置上下文。你也可以动态获取扩展 ID，并使用它来加载并测试弹出页面，例如。

🌐 To have the extension loaded when running tests you can use a test fixture to set the context. You can also dynamically retrieve the extension id and use it to load and test the popup page for example.

注意使用 `chromium` 通道，这允许以无头模式运行扩展程序。或者，你也可以以有头模式启动浏览器。

🌐 Note the use of the `chromium` channel that allows to run extensions in headless mode. Alternatively, you can launch the browser in headed mode.

首先，添加将加载扩展的装置：

🌐 First, add fixtures that will load the extension:

fixtures.ts

```json
import { test as base, chromium, type BrowserContext } from '@playwright/test';import path from 'path';export const test = base.extend<{  context: BrowserContext;  extensionId: string;}>({  context: async ({ }, use) => {    const pathToExtension = path.join(__dirname, 'my-extension');    const context = await chromium.launchPersistentContext('', {      channel: 'chromium',      args: [        `--disable-extensions-except=${pathToExtension}`,        `--load-extension=${pathToExtension}`,      ],    });    await use(context);    await context.close();  },  extensionId: async ({ context }, use) => {    // for manifest v3:    let [serviceWorker] = context.serviceWorkers();    if (!serviceWorker)      serviceWorker = await context.waitForEvent('serviceworker');    const extensionId = serviceWorker.url().split('/')[2];    await use(extensionId);  },});export const expect = test.expect;
```

然后在测试中使用这些装置：

🌐 Then use these fixtures in a test:

```ts
import { test, expect } from './fixtures';
test('example test', async ({ page }) => {
  await page.goto('https://example.com');  await expect(page.locator('body')).toHaveText('Changed by my-extension');
});
test('popup page', async ({ page, extensionId }) => {
  await page.goto(`chrome-extension://${extensionId}/popup.html`);  await expect(page.locator('body')).toHaveText('my-extension popup');
});
```
