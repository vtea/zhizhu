---
title: 事件
source_url: https://playwright.nodejs.cn/docs/events
fetched_at: 2026-04-29T02:57:28.664Z
---

# 事件

# 事件 | Playwright 中文网

[Skip to main content](http://playwright.nodejs.cn/docs/events#__docusaurus_skipToContent_fallback)

[![Image 1: Playwright logo](http://playwright.nodejs.cn/img/playwright-logo.svg) **Playwright Node.js 版本**](http://playwright.nodejs.cn/)[文档](http://playwright.nodejs.cn/docs/intro)[API](http://playwright.nodejs.cn/docs/api/class-playwright)

[Node.js](http://playwright.nodejs.cn/docs/events#)
*   [Node.js](http://playwright.nodejs.cn/docs/events)
*   [Python](http://playwright.nodejs.cn/python/docs/events)
*   [Java](http://playwright.nodejs.cn/java/docs/events)
*   [.NET](http://playwright.nodejs.cn/dotnet/docs/events)

[🌐 Nodejs.cn](https://nodejs.cn/#playwright)

Search K

*   [入门](http://playwright.nodejs.cn/docs/events#) 
    *   [安装](http://playwright.nodejs.cn/docs/intro)
    *   [编写测试](http://playwright.nodejs.cn/docs/writing-tests)
    *   [生成测试](http://playwright.nodejs.cn/docs/codegen-intro)
    *   [运行和调试测试](http://playwright.nodejs.cn/docs/running-tests)
    *   [跟踪查看器](http://playwright.nodejs.cn/docs/trace-viewer-intro)
    *   [设置 CI](http://playwright.nodejs.cn/docs/ci-intro)

*   [入门 - VS Code](http://playwright.nodejs.cn/docs/getting-started-vscode)
*   [发行说明](http://playwright.nodejs.cn/docs/release-notes)
*   [预览版本](http://playwright.nodejs.cn/docs/canary-releases)
*   [Playwright 测试](http://playwright.nodejs.cn/docs/events#) 
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

*   [指南](http://playwright.nodejs.cn/docs/events#) 
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

*   [迁移](http://playwright.nodejs.cn/docs/events#) 
*   [集成](http://playwright.nodejs.cn/docs/events#) 
*   [支持的语言](http://playwright.nodejs.cn/docs/languages)

*   [](http://playwright.nodejs.cn/)
*   指南
*   事件

On this page

# 事件

## 介绍

🌐 Introduction

Playwright 允许监听网页上发生的各种类型的事件，例如网络请求、子页面的创建、专用工作者等。有几种方法可以订阅此类事件，例如等待事件或添加或删除事件监听器。

🌐 Playwright allows listening to various types of events happening on the web page, such as network requests, creation of child pages, dedicated workers etc. There are several ways to subscribe to such events, such as waiting for events or adding or removing event listeners.

## 等待事件

🌐 Waiting for event

大多数情况下，脚本需要等待某个特定事件的发生。以下是一些典型的事件等待模式。

🌐 Most of the time, scripts will need to wait for a particular event to happen. Below are some of the typical event awaiting patterns.

使用 [page.waitForRequest()](http://playwright.nodejs.cn/docs/api/class-page#page-wait-for-request) 等待指定 URL 的请求：

🌐 Wait for a request with the specified url using [page.waitForRequest()](http://playwright.nodejs.cn/docs/api/class-page#page-wait-for-request):

```ts
// Start waiting for request before goto. Note no await.const requestPromise = page.waitForRequest('**/*logo*.png');
await page.goto('https://wikipedia.org');
const request = await requestPromise;
console.log(request.url());
```

等待弹出窗口：

🌐 Wait for popup window:

```ts
// Start waiting for popup before clicking. Note no await.const popupPromise = page.waitForEvent('popup');
await page.getByText('open the popup').click();
const popup = await popupPromise;
await popup.goto('https://wikipedia.org');
```

## 添加/删除事件监听器

🌐 Adding/removing event listener

有时，事件会在随机时间发生，与其等待它们，不如主动处理。Playwright 支持传统的语言机制来订阅和取消订阅事件：

🌐 Sometimes, events happen in random time and instead of waiting for them, they need to be handled. Playwright supports traditional language mechanisms for subscribing and unsubscribing from the events:

```ts
page.on('request', request => console.log(`Request sent: ${request.url()}`));
const listener = request => console.log(`Request finished: ${request.url()}`);
page.on('requestfinished', listener);
await page.goto('https://wikipedia.org');
page.off('requestfinished', listener);
await page.goto('https://www.openstreetmap.org/');
```

## 添加一次性监听器

🌐 Adding one-off listeners

如果某个事件需要处理一次，有一个方便的 API：

🌐 If a certain event needs to be handled once, there is a convenience API for that:

```ts
page.once('dialog', dialog => dialog.accept('2021'));
await page.evaluate("prompt('Enter a number:')");
```

[Previous 评估 JavaScript](http://playwright.nodejs.cn/docs/evaluating)[Next 可扩展性](http://playwright.nodejs.cn/docs/extensibility)

*   [介绍](http://playwright.nodejs.cn/docs/events#introduction)
*   [等待事件](http://playwright.nodejs.cn/docs/events#waiting-for-event)
*   [添加/删除事件监听器](http://playwright.nodejs.cn/docs/events#addingremoving-event-listener)
*   [添加一次性监听器](http://playwright.nodejs.cn/docs/events#adding-one-off-listeners)

Playwright 中文网 - 粤ICP备13048890号

[Nodejs.cn 旗下网站](https://nodejs.cn/#playwright)

[](https://wwads.cn/click/bait)[![Image 2: 万维广告联盟](https://cdn.wwads.cn/creatives/1ovXHr1r6tTukP9AYFPhUjfjZqFCTVW9Fb0ANOwr.png)](https://wwads.cn/click/bundle?code=ajlJa8rV6aWpUgpj8isT5twiz93mdE)

[📊 **开源免费的 BI 工具**。仅需 5 分钟，数据变大屏。众多精美可视化大屏模板等你来选。](https://wwads.cn/click/bundle?code=ajlJa8rV6aWpUgpj8isT5twiz93mdE)[![Image 3](http://playwright.nodejs.cn/docs/events)广告](https://wwads.cn/?utm_source=property-294&utm_medium=footer "点击了解万维广告联盟")

[](http://playwright.nodejs.cn/docs/events "隐藏广告")
