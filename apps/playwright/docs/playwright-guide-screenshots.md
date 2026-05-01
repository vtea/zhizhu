---
title: 截图
source_url: https://playwright.nodejs.cn/docs/screenshots
fetched_at: 2026-04-29T02:57:28.664Z
---

# 截图

# 截图 | Playwright 中文网

[Skip to main content](http://playwright.nodejs.cn/docs/screenshots#__docusaurus_skipToContent_fallback)

[![Image 1: Playwright logo](http://playwright.nodejs.cn/img/playwright-logo.svg) **Playwright Node.js 版本**](http://playwright.nodejs.cn/)[文档](http://playwright.nodejs.cn/docs/intro)[API](http://playwright.nodejs.cn/docs/api/class-playwright)

[Node.js](http://playwright.nodejs.cn/docs/screenshots#)
*   [Node.js](http://playwright.nodejs.cn/docs/screenshots)
*   [Python](http://playwright.nodejs.cn/python/docs/screenshots)
*   [Java](http://playwright.nodejs.cn/java/docs/screenshots)
*   [.NET](http://playwright.nodejs.cn/dotnet/docs/screenshots)

[🌐 Nodejs.cn](https://nodejs.cn/#playwright)

Search K

*   [入门](http://playwright.nodejs.cn/docs/screenshots#) 
    *   [安装](http://playwright.nodejs.cn/docs/intro)
    *   [编写测试](http://playwright.nodejs.cn/docs/writing-tests)
    *   [生成测试](http://playwright.nodejs.cn/docs/codegen-intro)
    *   [运行和调试测试](http://playwright.nodejs.cn/docs/running-tests)
    *   [跟踪查看器](http://playwright.nodejs.cn/docs/trace-viewer-intro)
    *   [设置 CI](http://playwright.nodejs.cn/docs/ci-intro)

*   [入门 - VS Code](http://playwright.nodejs.cn/docs/getting-started-vscode)
*   [发行说明](http://playwright.nodejs.cn/docs/release-notes)
*   [预览版本](http://playwright.nodejs.cn/docs/canary-releases)
*   [Playwright 测试](http://playwright.nodejs.cn/docs/screenshots#) 
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

*   [指南](http://playwright.nodejs.cn/docs/screenshots#) 
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

*   [迁移](http://playwright.nodejs.cn/docs/screenshots#) 
*   [集成](http://playwright.nodejs.cn/docs/screenshots#) 
*   [支持的语言](http://playwright.nodejs.cn/docs/languages)

*   [](http://playwright.nodejs.cn/)
*   指南
*   截图

On this page

# 截图

## 介绍

🌐 Introduction

以下是捕获屏幕截图并将其保存到文件中的快速方法：

🌐 Here is a quick way to capture a screenshot and save it into a file:

```ts
await page.screenshot({ path: 'screenshot.png' });
```

[Screenshots API](http://playwright.nodejs.cn/docs/api/class-page#page-screenshot) 接受许多用于图片格式、剪切区域、质量等的参数。请务必查看它们。

## 整页截图

🌐 Full page screenshots

全页屏幕截图是完整可滚动页面的屏幕截图，就好像你有一个非常高的屏幕并且页面可以完全容纳它一样。

🌐 Full page screenshot is a screenshot of a full scrollable page, as if you had a very tall screen and the page could fit it entirely.

```ts
await page.screenshot({ path: 'screenshot.png', fullPage: true });
```

## 捕获到缓冲区

🌐 Capture into buffer

你可以获取包含图片的缓冲区并对其进行后处理或将其传递给第三方像素差异工具，而不是写入文件。

🌐 Rather than writing into a file, you can get a buffer with the image and post-process it or pass it to a third party pixel diff facility.

```ts
const buffer = await page.screenshot();
console.log(buffer.toString('base64'));
```

## 元素截图

🌐 Element screenshot

有时，截取单个元素的屏幕截图很有用。

🌐 Sometimes it is useful to take a screenshot of a single element.

```ts
await page.locator('.header').screenshot({ path: 'screenshot.png' });
```

[Previous 页面对象模型](http://playwright.nodejs.cn/docs/pom)[Next 服务工作进程](http://playwright.nodejs.cn/docs/service-workers)

*   [介绍](http://playwright.nodejs.cn/docs/screenshots#introduction)
*   [整页截图](http://playwright.nodejs.cn/docs/screenshots#full-page-screenshots)
*   [捕获到缓冲区](http://playwright.nodejs.cn/docs/screenshots#capture-into-buffer)
*   [元素截图](http://playwright.nodejs.cn/docs/screenshots#element-screenshot)

Playwright 中文网 - 粤ICP备13048890号

[Nodejs.cn 旗下网站](https://nodejs.cn/#playwright)

[](https://wwads.cn/click/bait)[![Image 2: 万维广告联盟](https://cdn.wwads.cn/creatives/3ANNnx5pb3gSWJNriZkov0Pg2dh950VeRNHqaNOP.jpg)](https://wwads.cn/click/bundle?code=yjvq0L3MltGUVidft3MsaSUglTzFmN)

[🔥**跨端适配·模块解耦！**让自有App运行小程序，新功能热更新，**无需重构，代码可复用**](https://wwads.cn/click/bundle?code=yjvq0L3MltGUVidft3MsaSUglTzFmN)[![Image 3](http://playwright.nodejs.cn/docs/screenshots)广告](https://wwads.cn/?utm_source=property-294&utm_medium=footer "点击了解万维广告联盟")

[](http://playwright.nodejs.cn/docs/screenshots "隐藏广告")
