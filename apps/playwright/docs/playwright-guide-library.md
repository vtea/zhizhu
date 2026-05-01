---
title: 库
source_url: https://playwright.nodejs.cn/docs/library
fetched_at: 2026-04-29T02:57:28.664Z
---

# 库

## 介绍

🌐 Introduction

Playwright Library 提供用于启动浏览器并与浏览器交互的统一 API，而 Playwright Test 则提供所有这些以及完全托管的端到端测试运行程序和体验。

🌐 Playwright Library provides unified APIs for launching and interacting with browsers, while Playwright Test provides all this plus a fully managed end-to-end Test Runner and experience.

在大多数情况下，对于端到端测试，你会想使用 `@playwright/test`（Playwright Test），而不是直接使用 `playwright`（Playwright Library）。要开始使用 Playwright Test，请参阅 [入门指南](https://playwright.nodejs.cn/docs/intro)。

🌐 Under most circumstances, for end-to-end testing, you'll want to use `@playwright/test` (Playwright Test), and not `playwright` (Playwright Library) directly. To get started with Playwright Test, follow the [Getting Started Guide](https://playwright.nodejs.cn/docs/intro).

## 使用库时的差异

🌐 Differences when using library

### 库示例

🌐 Library Example

以下是直接使用 Playwright Library 启动 Chromium、转到页面并检查其标题的示例：

🌐 The following is an example of using the Playwright Library directly to launch Chromium, go to a page, and check its title:

*   TypeScript
*   JavaScript

```ts
import { chromium, devices } from 'playwright';
import assert from 'node:assert';
(async () => {
  // Setup  const browser = await chromium.launch();  const context = await browser.newContext(devices['iPhone 11']);  const page = await context.newPage();  // The actual interesting bit  await context.route('**.jpg', route => route.abort());  await page.goto('https://example.com/');  assert(await page.title() === 'Example Domain'); // 👎 not a Web First assertion  // Teardown  await context.close();  await browser.close();
})();
```

用 `node my-script.js` 运行它。

🌐 Run it with `node my-script.js`.

### 测试实例

🌐 Test Example

实现类似行为的测试如下所示：

🌐 A test to achieve similar behavior, would look like:

*   TypeScript
*   JavaScript

```ts
import { expect, test, devices } from '@playwright/test';
test.use(devices['iPhone 11']);
test('should be titled', async ({ page, context }) => {
  await context.route('**.jpg', route => route.abort());  await page.goto('https://example.com/');  await expect(page).toHaveTitle('Example');
});
```

用 `npx playwright test` 运行它。

🌐 Run it with `npx playwright test`.

### 主要差异

🌐 Key Differences

需要注意的主要区别如下：

🌐 The key differences to note are as follows:

| | 库 | 测试 |

| - | - | - |

| 安装 | `npm install playwright` | `npm init playwright@latest` - 注意 `install` 与 `init` |

| 安装浏览器 | 安装 `@playwright/browser-chromium`、`@playwright/browser-firefox` 和/或 `@playwright/browser-webkit` | 单独安装 `npx playwright install` 或 `npx playwright install chromium` |

| `import` 来自 | `playwright` | `@playwright/test` |

| 初始化 | 明确需要：

1.   选择一个要使用的浏览器，例如 `chromium`
2.   使用 [browserType.launch()](https://playwright.nodejs.cn/docs/api/class-browsertype#browser-type-launch) 启动浏览器
3.   使用 [browser.newContext()](https://playwright.nodejs.cn/docs/api/class-browser#browser-new-context) 创建一个上下文， _并且_ 显式传递任何上下文选项，例如 `devices['iPhone 11']`
4.   使用 [browserContext.newPage()](https://playwright.nodejs.cn/docs/api/class-browsercontext#browser-context-new-page) 创建一个页面

 | 每个测试默认会提供一个隔离的 `page` 和 `context`，以及其他 [内置夹具](https://playwright.nodejs.cn/docs/test-fixtures#built-in-fixtures)。无需显式创建。如果测试在其参数中引用它们，测试运行器将为该测试创建它们。（即懒初始化） |
| 断言 | 没有内置的 Web 优先断言 | 像这样的 [Web 优先断言](https://playwright.nodejs.cn/docs/test-assertions)：

*   [expect(page).toHaveTitle()](https://playwright.nodejs.cn/docs/api/class-pageassertions#page-assertions-to-have-title)
*   [expect(page).toHaveScreenshot()](https://playwright.nodejs.cn/docs/api/class-pageassertions#page-assertions-to-have-screenshot-1)

 它们会自动等待并重试直到条件满足。|
| 超时 | 大多数操作默认为30秒。 | 大多数操作不会超时，但每个测试都有一个超时，超时会导致测试失败（默认30秒）。 |

| 清理 | 明确需要做的操作：

1.   使用 [browserContext.close()](https://playwright.nodejs.cn/docs/api/class-browsercontext#browser-context-close) 关闭上下文
2.   使用 [browser.close()](https://playwright.nodejs.cn/docs/api/class-browser#browser-close) 关闭浏览器

 | 没有明确关闭 [内置夹具](https://playwright.nodejs.cn/docs/test-fixtures#built-in-fixtures)；测试运行器会处理它。
| 运行 | 使用库时，你以节点脚本的方式运行代码，可能需要先进行一些编译。 | 使用测试运行器时，你使用 `npx playwright test` 命令。结合你的 [配置](https://playwright.nodejs.cn/docs/test-configuration)，测试运行器会处理所有的编译工作，并决定运行什么以及如何运行它。 |

除上述内容外，Playwright Test 作为一个功能齐全的测试运行程序，还包括：

🌐 In addition to the above, Playwright Test, as a full-featured Test Runner, includes:

*   [配置矩阵和项目](https://playwright.nodejs.cn/docs/test-configuration)：在上述示例中，在 Playwright 库版本中，如果我们想使用不同的设备或浏览器运行测试，就必须修改脚本并传递相关信息。而使用 Playwright Test，我们只需在一个地方指定配置矩阵[矩阵配置](https://playwright.nodejs.cn/docs/test-configuration)，它就会在每种配置下运行相同的测试。
*   [Parallelization](https://playwright.nodejs.cn/docs/test-parallel)
*   [以网络为先的断言](https://playwright.nodejs.cn/docs/test-assertions)
*   [Reporting](https://playwright.nodejs.cn/docs/test-reporters)
*   [Retries](https://playwright.nodejs.cn/docs/test-retries)
*   [轻松启用追踪](https://playwright.nodejs.cn/docs/trace-viewer-intro)
*   和更多…

## 用法

🌐 Usage

在你的 Node.js 项目中使用 npm 或 Yarn 安装 Playwright 库。请参见[系统要求](https://playwright.nodejs.cn/docs/intro#system-requirements)。

🌐 Use npm or Yarn to install Playwright library in your Node.js project. See [system requirements](https://playwright.nodejs.cn/docs/intro#system-requirements).

`npm i -D playwright`

你还需要安装浏览器——可以手动安装，也可以通过添加一个自动为你安装的包来完成。

🌐 You will also need to install browsers - either manually or by adding a package that will do it for you automatically.

```
# Download the Chromium, Firefox and WebKit browsernpx playwright install chromium firefox webkit# Alternatively, add packages that will download a browser upon npm installnpm i -D @playwright/browser-chromium @playwright/browser-firefox @playwright/browser-webkit
```

有关更多选项，请参阅[管理浏览器](https://playwright.nodejs.cn/docs/browsers#managing-browser-binaries)。

🌐 See [managing browsers](https://playwright.nodejs.cn/docs/browsers#managing-browser-binaries) for more options.

安装完成后，你可以在 Node.js 脚本中导入 Playwright，并启动任意三种浏览器（`chromium`、`firefox` 和 `webkit`）。

🌐 Once installed, you can import Playwright in a Node.js script, and launch any of the 3 browsers (`chromium`, `firefox` and `webkit`).

```ts
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();  // Create pages, interact with UI elements, assert values  await browser.close();
})();
```

Playwright 的 API 是异步的，并返回 Promise 对象。我们的代码示例使用 [async/await 模式](https://web.nodejs.cn/en-US/docs/Learn/JavaScript/Asynchronous/Async_await) 来提高可读性。代码被封装在一个匿名的异步箭头函数中，并且该函数会自我调用。

🌐 Playwright APIs are asynchronous and return Promise objects. Our code examples use [the async/await pattern](https://web.nodejs.cn/en-US/docs/Learn/JavaScript/Asynchronous/Async_await) to ease readability. The code is wrapped in an unnamed async arrow function which is invoking itself.

```
(async () => { // Start of async arrow function  // Function code  // ...})(); // End of the function and () to invoke itself
```

## 第一个脚本

🌐 First script

在我们的第一个脚本中，我们将导航到 `https://playwright.nodejs.cn/` 并在 WebKit 中截取屏幕截图。

🌐 In our first script, we will navigate to `https://playwright.nodejs.cn/` and take a screenshot in WebKit.

```ts
const { webkit } = require('playwright');
(async () => {
  const browser = await webkit.launch();  const page = await browser.newPage();  await page.goto('https://playwright.nodejs.cn/');  await page.screenshot({ path: `example.png` });  await browser.close();
})();
```

默认情况下，Playwright 会以无头模式运行浏览器。要查看浏览器界面，请在启动浏览器时传入 `headless: false` 标志。你也可以使用 `slowMo` 来减慢执行速度。更多信息请参阅调试工具[部分](https://playwright.nodejs.cn/docs/debug)。

🌐 By default, Playwright runs the browsers in headless mode. To see the browser UI, pass the `headless: false` flag while launching the browser. You can also use `slowMo` to slow down execution. Learn more in the debugging tools [section](https://playwright.nodejs.cn/docs/debug).

```
firefox.launch({ headless: false, slowMo: 50 });
```

## 录制脚本

🌐 Record scripts

[命令行工具](https://playwright.nodejs.cn/docs/test-cli) 可用于记录用户交互并生成 JavaScript 代码。

```bash
npx playwright codegen wikipedia.org
```

## 浏览器下载

🌐 Browser downloads

要下载 Playwright 浏览器，请运行：

🌐 To download Playwright browsers run:

```
# Explicitly download browsersnpx playwright install
```

或者，你可以添加 `@playwright/browser-chromium`、`@playwright/browser-firefox` 和 `@playwright/browser-webkit` 包，在安装这些包时自动下载相应的浏览器。

🌐 Alternatively, you can add `@playwright/browser-chromium`, `@playwright/browser-firefox` and `@playwright/browser-webkit` packages to automatically download the respective browser during the package installation.

```
# Use a helper package that downloads a browser on npm installnpm install @playwright/browser-chromium
```

**在防火墙或代理后下载**

通过 `HTTPS_PROXY` 环境变量通过代理进行下载。

🌐 Pass `HTTPS_PROXY` environment variable to download through a proxy.

*   Bash
*   PowerShell
*   Batch

```
# ManualHTTPS_PROXY=https://192.0.2.1 npx playwright install# Through @playwright/browser-chromium, @playwright/browser-firefox# and @playwright/browser-webkit helper packagesHTTPS_PROXY=https://192.0.2.1 npm install
```

**从制品仓库下载**

默认情况下，Playwright 会从微软的 CDN 下载浏览器。传递 `PLAYWRIGHT_DOWNLOAD_HOST` 环境变量即可改为从内部资源仓库下载。

🌐 By default, Playwright downloads browsers from Microsoft's CDN. Pass `PLAYWRIGHT_DOWNLOAD_HOST` environment variable to download from an internal artifacts repository instead.

*   Bash
*   PowerShell
*   Batch

```
# ManualPLAYWRIGHT_DOWNLOAD_HOST=192.0.2.1 npx playwright install# Through @playwright/browser-chromium, @playwright/browser-firefox# and @playwright/browser-webkit helper packagesPLAYWRIGHT_DOWNLOAD_HOST=192.0.2.1 npm install
```

**跳过浏览器下载**

在某些情况下，希望完全避免浏览器下载，因为浏览器二进制文件是单独管理的。这可以通过在安装软件包之前设置 `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD` 变量来实现。

🌐 In certain cases, it is desired to avoid browser downloads altogether because browser binaries are managed separately. This can be done by setting `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD` variable before installing packages.

*   Bash
*   PowerShell
*   Batch

```
# When using @playwright/browser-chromium, @playwright/browser-firefox# and @playwright/browser-webkit helper packagesPLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install
```

## TypeScript 支持

🌐 TypeScript support

Playwright 内置支持 TypeScript。类型定义将会自动导入。建议使用类型检查以改善 IDE 的使用体验。

🌐 Playwright includes built-in support for TypeScript. Type definitions will be imported automatically. It is recommended to use type-checking to improve the IDE experience.

### 在 JavaScript 中

🌐 In JavaScript

将以下内容添加到 JavaScript 文件的顶部，以在 VS Code 或 WebStorm 中进行类型检查。

🌐 Add the following to the top of your JavaScript file to get type-checking in VS Code or WebStorm.

`// @ts-check// ...`

或者，你可以使用 JSDoc 设置变量的类型。

🌐 Alternatively, you can use JSDoc to set types for variables.

```ts
/** @type {import('playwright').Page} */let page;
```

### 在 TypeScript 中

🌐 In TypeScript

TypeScript 支持将开箱即用。类型也可以显式导入。

🌐 TypeScript support will work out-of-the-box. Types can also be imported explicitly.

```ts
let page: import('playwright').Page;
```
