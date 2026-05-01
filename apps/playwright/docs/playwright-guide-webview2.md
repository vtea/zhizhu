---
title: WebView2
source_url: https://playwright.nodejs.cn/docs/webview2
fetched_at: 2026-04-29T02:57:28.664Z
---

# WebView2

🌐 Introduction

以下将说明如何将 Playwright 与 [Microsoft Edge WebView2](https://docs.microsoft.com/en-us/microsoft-edge/webview2/) 一起使用。WebView2 是一个 WinForms 控件，它在底层使用 Microsoft Edge 来渲染网页内容。它是 Microsoft Edge 浏览器的一部分，可在 Windows 10 和 Windows 11 上使用。Playwright 可以用于自动化 WebView2 应用，并可用于测试 WebView2 中的网页内容。要连接到 WebView2，Playwright 使用 [browserType.connectOverCDP()](https://playwright.nodejs.cn/docs/api/class-browsertype#browser-type-connect-over-cdp)，通过 Chrome 开发者工具协议（CDP）进行连接。

🌐 The following will explain how to use Playwright with [Microsoft Edge WebView2](https://docs.microsoft.com/en-us/microsoft-edge/webview2/). WebView2 is a WinForms control, which will use Microsoft Edge under the hood to render web content. It is a part of the Microsoft Edge browser and is available on Windows 10 and Windows 11. Playwright can be used to automate WebView2 applications and can be used to test web content in WebView2. For connecting to WebView2, Playwright uses [browserType.connectOverCDP()](https://playwright.nodejs.cn/docs/api/class-browsertype#browser-type-connect-over-cdp) which connects to it via the Chrome DevTools Protocol (CDP).

## 概述

🌐 Overview

可以通过设置 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` 环境变量为 `--remote-debugging-port=9222`，或调用带有 `--remote-debugging-port=9222` 参数的 [EnsureCoreWebView2Async](https://docs.microsoft.com/en-us/dotnet/api/microsoft.web.webview2.wpf.webview2.ensurecorewebview2async?view=webview2-dotnet-1.0.1343.22) 来指示 WebView2 控件监听传入的 CDP 连接。这将以启用 Chrome 开发者工具协议的方式启动 WebView2 进程，从而允许使用 Playwright 进行自动化。9222 在此示例中是一个端口，但也可以使用其他未占用的端口。

🌐 A WebView2 control can be instructed to listen to incoming CDP connections by setting either the `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` environment variable with `--remote-debugging-port=9222` or calling [EnsureCoreWebView2Async](https://docs.microsoft.com/en-us/dotnet/api/microsoft.web.webview2.wpf.webview2.ensurecorewebview2async?view=webview2-dotnet-1.0.1343.22) with the `--remote-debugging-port=9222` argument. This will start the WebView2 process with the Chrome DevTools Protocol enabled which allows the automation by Playwright. 9222 is an example port in this case, but any other unused port can be used as well.

```ts
await this.webView.EnsureCoreWebView2Async(await CoreWebView2Environment.CreateAsync(null, null, new CoreWebView2EnvironmentOptions(){
  AdditionalBrowserArguments = "--remote-debugging-port=9222",})).ConfigureAwait(false);
```

一旦带有 WebView2 控件的应用运行，你就可以通过 Playwright 连接到它：

🌐 Once your application with the WebView2 control is running, you can connect to it via Playwright:

```ts
const browser = await playwright.chromium.connectOverCDP('http://localhost:9222');
const context = browser.contexts()[0];
const page = context.pages()[0];
```

为了确保 WebView2 控件已准备好，你可以等待 [`CoreWebView2InitializationCompleted`](https://learn.microsoft.com/en-us/dotnet/api/microsoft.web.webview2.wpf.webview2.corewebview2initializationcompleted?view=webview2-dotnet-1.0.1343.22) 事件：

🌐 To ensure that the WebView2 control is ready, you can wait for the [`CoreWebView2InitializationCompleted`](https://learn.microsoft.com/en-us/dotnet/api/microsoft.web.webview2.wpf.webview2.corewebview2initializationcompleted?view=webview2-dotnet-1.0.1343.22) event:

```
this.webView.CoreWebView2InitializationCompleted += (_, e) =>{
  if (e.IsSuccess)    {
  Console.WriteLine("WebView2 initialized");    }};
```

## 编写和运行测试

🌐 Writing and running tests

默认情况下，WebView2 控件会为所有实例使用相同的用户数据目录。这意味着如果你并行运行多个测试，它们会相互干扰。为避免这种情况，你应该为每个测试将 `WEBVIEW2_USER_DATA_FOLDER` 环境变量（或使用 [WebView2.EnsureCoreWebView2Async 方法](https://docs.microsoft.com/en-us/dotnet/api/microsoft.web.webview2.wpf.webview2.ensurecorewebview2async?view=webview2-dotnet-1.0.1343.22)）设置为不同的文件夹。这将确保每个测试在自己的用户数据目录中运行。

🌐 By default, the WebView2 control will use the same user data directory for all instances. This means that if you run multiple tests in parallel, they will interfere with each other. To avoid this, you should set the `WEBVIEW2_USER_DATA_FOLDER` environment variable (or use [WebView2.EnsureCoreWebView2Async Method](https://docs.microsoft.com/en-us/dotnet/api/microsoft.web.webview2.wpf.webview2.ensurecorewebview2async?view=webview2-dotnet-1.0.1343.22)) to a different folder for each test. This will make sure that each test runs in its own user data directory.

使用以下方法，Playwright 将以子进程的方式运行你的 WebView2 应用，为其分配一个唯一的用户数据目录，并将 [Page](https://playwright.nodejs.cn/docs/api/class-page "Page") 实例提供给你的测试：

🌐 Using the following, Playwright will run your WebView2 application as a sub-process, assign a unique user data directory to it and provide the [Page](https://playwright.nodejs.cn/docs/api/class-page "Page") instance to your test:

webView2Test.ts

```json
import { test as base } from '@playwright/test';import fs from 'fs';import os from 'os';import path from 'path';import childProcess from 'child_process';const EXECUTABLE_PATH = path.join(    __dirname,    '../../webview2-app/bin/Debug/net8.0-windows/webview2.exe',);export const test = base.extend({  browser: async ({ playwright }, use, testInfo) => {    const cdpPort = 10000 + testInfo.workerIndex;    // Make sure that the executable exists and is executable    fs.accessSync(EXECUTABLE_PATH, fs.constants.X_OK);    const userDataDir = path.join(        fs.realpathSync.native(os.tmpdir()),        `playwright-webview2-tests/user-data-dir-${testInfo.workerIndex}`,    );    const webView2Process = childProcess.spawn(EXECUTABLE_PATH, [], {      shell: true,      env: {        ...process.env,        WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${cdpPort}`,        WEBVIEW2_USER_DATA_FOLDER: userDataDir,      }    });    await new Promise<void>(resolve => webView2Process.stdout.on('data', data => {      if (data.toString().includes('WebView2 initialized'))        resolve();    }));    const browser = await playwright.chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);    await use(browser);    await browser.close();    childProcess.execSync(`taskkill /pid ${webView2Process.pid} /T /F`);    fs.rmdirSync(userDataDir, { recursive: true });  },  context: async ({ browser }, use) => {    const context = browser.contexts()[0];    await use(context);  },  page: async ({ context }, use) => {    const page = context.pages()[0];    await use(page);  },});export { expect } from '@playwright/test';
```

example.spec.ts

```ts
import { test, expect } from './webView2Test';
test('test WebView2', async ({ page }) => {
  await page.goto('https://playwright.nodejs.cn');  const getStarted = page.getByText('Get Started');  await expect(getStarted).toBeVisible();
});
```

## 调试

🌐 Debugging

在你的 WebView2 控件内，你可以右键点击以打开上下文菜单并选择“检查”以打开开发者工具，或者按 F12。你也可以使用 [WebView2.CoreWebView2.OpenDevToolsWindow](https://learn.microsoft.com/en-us/dotnet/api/microsoft.web.webview2.core.corewebview2.opendevtoolswindow?view=webview2-dotnet-1.0.1462.37) 方法以编程方式打开开发者工具。

有关调试测试，请参阅 Playwright 的[调试指南](https://playwright.nodejs.cn/docs/debug)。

🌐 For debugging tests, see the Playwright [Debugging guide](https://playwright.nodejs.cn/docs/debug).
