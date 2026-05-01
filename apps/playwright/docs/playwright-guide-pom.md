---
title: 页面对象模型
source_url: https://playwright.nodejs.cn/docs/pom
fetched_at: 2026-04-29T02:57:28.664Z
---

# 页面对象模型

# 页面对象模型 | Playwright 中文网

[Skip to main content](http://playwright.nodejs.cn/docs/pom#__docusaurus_skipToContent_fallback)

[![Image 1: Playwright logo](http://playwright.nodejs.cn/img/playwright-logo.svg) **Playwright Node.js 版本**](http://playwright.nodejs.cn/)[文档](http://playwright.nodejs.cn/docs/intro)[API](http://playwright.nodejs.cn/docs/api/class-playwright)

[Node.js](http://playwright.nodejs.cn/docs/pom#)
*   [Node.js](http://playwright.nodejs.cn/docs/pom)
*   [Python](http://playwright.nodejs.cn/python/docs/pom)
*   [Java](http://playwright.nodejs.cn/java/docs/pom)
*   [.NET](http://playwright.nodejs.cn/dotnet/docs/pom)

[🌐 Nodejs.cn](https://nodejs.cn/#playwright)

Search K

*   [入门](http://playwright.nodejs.cn/docs/pom#) 
    *   [安装](http://playwright.nodejs.cn/docs/intro)
    *   [编写测试](http://playwright.nodejs.cn/docs/writing-tests)
    *   [生成测试](http://playwright.nodejs.cn/docs/codegen-intro)
    *   [运行和调试测试](http://playwright.nodejs.cn/docs/running-tests)
    *   [跟踪查看器](http://playwright.nodejs.cn/docs/trace-viewer-intro)
    *   [设置 CI](http://playwright.nodejs.cn/docs/ci-intro)

*   [入门 - VS Code](http://playwright.nodejs.cn/docs/getting-started-vscode)
*   [发行说明](http://playwright.nodejs.cn/docs/release-notes)
*   [预览版本](http://playwright.nodejs.cn/docs/canary-releases)
*   [Playwright 测试](http://playwright.nodejs.cn/docs/pom#) 
    *   [代理](http://playwright.nodejs.cn/docs/test-agents)
    *   [注释](http://playwright.nodejs.cn/docs/test-annotations)
    *   [命令行](http://playwright.nodejs.cn/docs/test-cli)
    *   [配置](http://playwright.nodejs.cn/docs/test-configuration)
    *   [配置（使用）](http://playwright.nodejs.cn/docs/test-use-options)
    *   [模拟](http://playwright.nodejs.cn/docs/emulation)
    *   [夹具](http://playwright.nodejs.cn/docs/test-fixtures)
    *   [全局设置和拆卸](http://playwright.nodejs.cn/docs/test-global-setup-teardown)
    *   [并行性](http://playwright.nodejs.cn/docs/test-parallel)
    *   [参数化测试](http://playwright.nodejs.cn/docs/test-parameterize)
    *   [项目](http://playwright.nodejs.cn/docs/test-projects)
    *   [报告器](http://playwright.nodejs.cn/docs/test-reporters)
    *   [重试](http://playwright.nodejs.cn/docs/test-retries)
    *   [分片](http://playwright.nodejs.cn/docs/test-sharding)
    *   [超时](http://playwright.nodejs.cn/docs/test-timeouts)
    *   [TypeScript](http://playwright.nodejs.cn/docs/test-typescript)
    *   [用户界面模式](http://playwright.nodejs.cn/docs/test-ui-mode)
    *   [网络服务器](http://playwright.nodejs.cn/docs/test-webserver)

*   [指南](http://playwright.nodejs.cn/docs/pom#) 
    *   [库](http://playwright.nodejs.cn/docs/library)
    *   [无障碍测试](http://playwright.nodejs.cn/docs/accessibility-testing)
    *   [行动](http://playwright.nodejs.cn/docs/input)
    *   [断言](http://playwright.nodejs.cn/docs/test-assertions)
    *   [API 测试](http://playwright.nodejs.cn/docs/api-testing)
    *   [验证](http://playwright.nodejs.cn/docs/auth)
    *   [自动等待](http://playwright.nodejs.cn/docs/actionability)
    *   [最佳实践](http://playwright.nodejs.cn/docs/best-practices)
    *   [浏览器](http://playwright.nodejs.cn/docs/browsers)
    *   [Chrome 扩展程序](http://playwright.nodejs.cn/docs/chrome-extensions)
    *   [时钟](http://playwright.nodejs.cn/docs/clock)
    *   [组件（实验）](http://playwright.nodejs.cn/docs/test-components)
    *   [调试测试](http://playwright.nodejs.cn/docs/debug)
    *   [对话框](http://playwright.nodejs.cn/docs/dialogs)
    *   [下载](http://playwright.nodejs.cn/docs/downloads)
    *   [评估 JavaScript](http://playwright.nodejs.cn/docs/evaluating)
    *   [事件](http://playwright.nodejs.cn/docs/events)
    *   [可扩展性](http://playwright.nodejs.cn/docs/extensibility)
    *   [框架](http://playwright.nodejs.cn/docs/frames)
    *   [句柄](http://playwright.nodejs.cn/docs/handles)
    *   [隔离](http://playwright.nodejs.cn/docs/browser-contexts)
    *   [定位器](http://playwright.nodejs.cn/docs/locators)
    *   [模拟 API](http://playwright.nodejs.cn/docs/mock)
    *   [模拟浏览器 API](http://playwright.nodejs.cn/docs/mock-browser-apis)
    *   [导航](http://playwright.nodejs.cn/docs/navigations)
    *   [网络](http://playwright.nodejs.cn/docs/network)
    *   [其他定位器](http://playwright.nodejs.cn/docs/other-locators)
    *   [页面](http://playwright.nodejs.cn/docs/pages)
    *   [页面对象模型](http://playwright.nodejs.cn/docs/pom)
    *   [截图](http://playwright.nodejs.cn/docs/screenshots)
    *   [服务工作进程](http://playwright.nodejs.cn/docs/service-workers)
    *   [快照测试](http://playwright.nodejs.cn/docs/aria-snapshots)
    *   [测试生成器](http://playwright.nodejs.cn/docs/codegen)
    *   [触摸事件（旧版）](http://playwright.nodejs.cn/docs/touch-events)
    *   [跟踪查看器](http://playwright.nodejs.cn/docs/trace-viewer)
    *   [视频](http://playwright.nodejs.cn/docs/videos)
    *   [视觉比较](http://playwright.nodejs.cn/docs/test-snapshots)
    *   [WebView2](http://playwright.nodejs.cn/docs/webview2)

*   [迁移](http://playwright.nodejs.cn/docs/pom#) 
*   [集成](http://playwright.nodejs.cn/docs/pom#) 
*   [支持的语言](http://playwright.nodejs.cn/docs/languages)

*   [](http://playwright.nodejs.cn/)
*   指南
*   页面对象模型

On this page

# 页面对象模型

## 介绍

🌐 Introduction

大型测试套件可以通过结构化来优化编写和维护的便利性。页面对象模型就是一种用于结构化测试套件的方法。

🌐 Large test suites can be structured to optimize ease of authoring and maintenance. Page object models are one such approach to structure your test suite.

页面对象表示你的网络应用的一部分。一个电子商务网站可能有首页、商品列表页和结账页。它们每个都可以通过页面对象模型来表示。

🌐 A page object represents a part of your web application. An e-commerce web application might have a home page, a listings page and a checkout page. Each of them can be represented by page object models.

页面对象通过创建适合你应用的高级 API 来**简化编写**，并通过将元素选择器集中管理以及创建可重用代码来避免重复，从而**简化维护**。

🌐 Page objects **simplify authoring** by creating a higher-level API which suits your application and **simplify maintenance** by capturing element selectors in one place and create reusable code to avoid repetition.

## 执行

🌐 Implementation

我们将创建一个 `PlaywrightDevPage` 辅助类来封装对 `playwright.dev` 页面上的常用操作。在内部，它将使用 `page` 对象。

🌐 We will create a `PlaywrightDevPage` helper class to encapsulate common operations on the `playwright.dev` page. Internally, it will use the `page` object.

*   Test
*   Library

playwright-dev-page.ts

```ts
import { expect, type Locator, type Page } from '@playwright/test';
export class PlaywrightDevPage {
  readonly page: Page;  readonly getStartedLink: Locator;  readonly gettingStartedHeader: Locator;  readonly pomLink: Locator;  readonly tocList: Locator;  constructor(page: Page) {
  this.page = page;    this.getStartedLink = page.locator('a', { hasText: 'Get started' });    this.gettingStartedHeader = page.locator('h1', { hasText: 'Installation' });    this.pomLink = page.locator('li', {
  hasText: 'Guides',    }).locator('a', {
  hasText: 'Page Object Model',    });    this.tocList = page.locator('article div.markdown ul > li > a');  }  async goto() {
  await this.page.goto('https://playwright.nodejs.cn');  }  async getStarted() {
  await this.getStartedLink.first().click();    await expect(this.gettingStartedHeader).toBeVisible();  }  async pageObjectModel() {
  await this.getStarted();    await this.pomLink.click();  }}
```

models/PlaywrightDevPage.js

```ts
class PlaywrightDevPage {
  /**   * @param {import('playwright').Page} page   */  constructor(page) {
  this.page = page;    this.getStartedLink = page.locator('a', { hasText: 'Get started' });    this.gettingStartedHeader = page.locator('h1', { hasText: 'Installation' });    this.pomLink = page.locator('li', {
  hasText: 'Playwright Test',    }).locator('a', {
  hasText: 'Page Object Model',    });    this.tocList = page.locator('article div.markdown ul > li > a');  }  async getStarted() {
  await this.getStartedLink.first().click();    await expect(this.gettingStartedHeader).toBeVisible();  }  async pageObjectModel() {
  await this.getStarted();    await this.pomLink.click();  }}module.exports = { PlaywrightDevPage };
```

现在我们可以在测试中使用 `PlaywrightDevPage` 类了。

🌐 Now we can use the `PlaywrightDevPage` class in our tests.

*   Test
*   Library

example.spec.ts

```ts
import { test, expect } from '@playwright/test';
import { PlaywrightDevPage } from './playwright-dev-page';
test('getting started should contain table of contents', async ({ page }) => {
  const playwrightDev = new PlaywrightDevPage(page);  await playwrightDev.goto();  await playwrightDev.getStarted();  await expect(playwrightDev.tocList).toHaveText([    `How to install Playwright`,    `What's Installed`,    `How to run the example test`,    `How to open the HTML test report`,    `Write tests using web first assertions, page fixtures and locators`,    `Run single test, multiple tests, headed mode`,    `Generate tests with Codegen`,    `See a trace of your tests`  ]);
});
test('should show Page Object Model article', async ({ page }) => {
  const playwrightDev = new PlaywrightDevPage(page);  await playwrightDev.goto();  await playwrightDev.pageObjectModel();  await expect(page.locator('article')).toContainText('Page Object Model is a common pattern');
});
```

example.spec.js

```ts
const { PlaywrightDevPage } = require('./playwright-dev-page');
// In the testconst page = await browser.newPage();
await playwrightDev.goto();
await playwrightDev.getStarted();
await expect(playwrightDev.tocList).toHaveText([  `How to install Playwright`,  `What's Installed`,  `How to run the example test`,  `How to open the HTML test report`,  `Write tests using web first assertions, page fixtures and locators`,  `Run single test, multiple tests, headed mode`,  `Generate tests with Codegen`,  `See a trace of your tests`]);
```

[Previous 页面](http://playwright.nodejs.cn/docs/pages)[Next 截图](http://playwright.nodejs.cn/docs/screenshots)

*   [介绍](http://playwright.nodejs.cn/docs/pom#introduction)
*   [执行](http://playwright.nodejs.cn/docs/pom#implementation)

Playwright 中文网 - 粤ICP备13048890号

[Nodejs.cn 旗下网站](https://nodejs.cn/#playwright)

[](https://wwads.cn/click/bait)[![Image 2: 万维广告联盟](https://cdn.wwads.cn/creatives/fZl7TknJRVr02tqVRhFP0xBkvUPIT7mDCcY0sBuV.png)](https://wwads.cn/click/bundle?code=XjfZQY0a7PQ7ibel2ivZmTs49cx8p9)

[电商项目必备！Java 开源商城系统 SpringBoot+Vue ，功能齐全，全源码交付，可二开](https://wwads.cn/click/bundle?code=XjfZQY0a7PQ7ibel2ivZmTs49cx8p9)[![Image 3](http://playwright.nodejs.cn/docs/pom)广告](https://wwads.cn/?utm_source=property-294&utm_medium=footer "点击了解万维广告联盟")

[](http://playwright.nodejs.cn/docs/pom "隐藏广告")
