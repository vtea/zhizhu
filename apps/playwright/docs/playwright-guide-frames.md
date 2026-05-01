---
title: 框架
source_url: https://playwright.nodejs.cn/docs/frames
fetched_at: 2026-04-29T02:57:28.664Z
---

# 框架

# 框架 | Playwright 中文网

[Skip to main content](http://playwright.nodejs.cn/docs/frames#__docusaurus_skipToContent_fallback)

[![Image 1: Playwright logo](http://playwright.nodejs.cn/img/playwright-logo.svg) **Playwright Node.js 版本**](http://playwright.nodejs.cn/)[文档](http://playwright.nodejs.cn/docs/intro)[API](http://playwright.nodejs.cn/docs/api/class-playwright)

[Node.js](http://playwright.nodejs.cn/docs/frames#)
*   [Node.js](http://playwright.nodejs.cn/docs/frames)
*   [Python](http://playwright.nodejs.cn/python/docs/frames)
*   [Java](http://playwright.nodejs.cn/java/docs/frames)
*   [.NET](http://playwright.nodejs.cn/dotnet/docs/frames)

[🌐 Nodejs.cn](https://nodejs.cn/#playwright)

Search K

*   [入门](http://playwright.nodejs.cn/docs/frames#) 
    *   [安装](http://playwright.nodejs.cn/docs/intro)
    *   [编写测试](http://playwright.nodejs.cn/docs/writing-tests)
    *   [生成测试](http://playwright.nodejs.cn/docs/codegen-intro)
    *   [运行和调试测试](http://playwright.nodejs.cn/docs/running-tests)
    *   [跟踪查看器](http://playwright.nodejs.cn/docs/trace-viewer-intro)
    *   [设置 CI](http://playwright.nodejs.cn/docs/ci-intro)

*   [入门 - VS Code](http://playwright.nodejs.cn/docs/getting-started-vscode)
*   [发行说明](http://playwright.nodejs.cn/docs/release-notes)
*   [预览版本](http://playwright.nodejs.cn/docs/canary-releases)
*   [Playwright 测试](http://playwright.nodejs.cn/docs/frames#) 
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

*   [指南](http://playwright.nodejs.cn/docs/frames#) 
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

*   [迁移](http://playwright.nodejs.cn/docs/frames#) 
*   [集成](http://playwright.nodejs.cn/docs/frames#) 
*   [支持的语言](http://playwright.nodejs.cn/docs/languages)

*   [](http://playwright.nodejs.cn/)
*   指南
*   框架

On this page

# 框架

## 介绍

🌐 Introduction

一个[页面](http://playwright.nodejs.cn/docs/api/class-page "Page")可以附加一个或多个[框架](http://playwright.nodejs.cn/docs/api/class-frame "Frame")对象。每个页面都有一个主框架，并且页面级交互（如`click`）默认在主框架中操作。

🌐 A [Page](http://playwright.nodejs.cn/docs/api/class-page "Page") can have one or more [Frame](http://playwright.nodejs.cn/docs/api/class-frame "Frame") objects attached to it. Each page has a main frame and page-level interactions (like `click`) are assumed to operate in the main frame.

一个页面可以通过 `iframe` HTML 标签附加额外的框架。可以访问这些框架以在框架内进行交互。

🌐 A page can have additional frames attached with the `iframe` HTML tag. These frames can be accessed for interactions inside the frame.

```ts
// Locate element inside frameconst username = await page.frameLocator('.frame-class').getByLabel('User Name');
await username.fill('John');
```

## 框架对象

🌐 Frame objects

可以使用 [page.frame()](http://playwright.nodejs.cn/docs/api/class-page#page-frame) API 访问框架对象：

🌐 One can access frame objects using the [page.frame()](http://playwright.nodejs.cn/docs/api/class-page#page-frame) API:

```ts
// Get frame using the frame's name attributeconst frame = page.frame('frame-login');
// Get frame using frame's URLconst frame = page.frame({ url: /.*domain.*/ });
// Interact with the frameawait frame.fill('#username-input', 'John');
```

[Previous 可扩展性](http://playwright.nodejs.cn/docs/extensibility)[Next 句柄](http://playwright.nodejs.cn/docs/handles)

*   [介绍](http://playwright.nodejs.cn/docs/frames#introduction)
*   [框架对象](http://playwright.nodejs.cn/docs/frames#frame-objects)

Playwright 中文网 - 粤ICP备13048890号

[Nodejs.cn 旗下网站](https://nodejs.cn/#playwright)

[](https://wwads.cn/click/bait)[![Image 2: 万维广告联盟](https://cdn.wwads.cn/creatives/TVj7qwKmV9On1vZPE3AuThgEmauC99ElKcTwaNw7.jpg)](https://wwads.cn/click/bundle?code=wjUkTBSGjr6I0afLRcRzWaJgIz65yz)

[**点击免费下载 ⏬ 医院/学校/企业 业务管理信息系统源码 🚩开箱即用 二开方便 定期迭代**](https://wwads.cn/click/bundle?code=wjUkTBSGjr6I0afLRcRzWaJgIz65yz)[![Image 3](http://playwright.nodejs.cn/docs/frames)广告](https://wwads.cn/?utm_source=property-294&utm_medium=footer "点击了解万维广告联盟")

[](http://playwright.nodejs.cn/docs/frames "隐藏广告")
