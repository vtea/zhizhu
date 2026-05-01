---
title: 服务工作进程
source_url: https://playwright.nodejs.cn/docs/service-workers
fetched_at: 2026-04-29T02:57:28.664Z
---

# 服务工作进程

## 介绍

🌐 Introduction

warning

服务工作者仅在基于 Chromium 的浏览器上受支持。

🌐 Service workers are only supported on Chromium-based browsers.

note

如果你想进行一般的网络模拟、路由和拦截，请先查看[网络指南](https://playwright.nodejs.cn/docs/network)。Playwright 为此用例提供了内置 API，不需要以下信息。然而，如果你对 Service Worker 自身发出的请求感兴趣，请继续阅读以下内容。

[Service Workers](https://web.nodejs.cn/en-US/docs/Web/API/Service_Worker_API) 提供了一种浏览器原生方法，用于处理页面通过原生 [Fetch API (`fetch`)](https://web.nodejs.cn/en-US/docs/Web/API/Fetch_API) 发出的请求，以及其他网络请求的资源（如脚本、CSS 和图片）。

它们可以作为页面与外部网络之间的**网络代理**来执行缓存逻辑，或者如果 Service Worker 添加了 [FetchEvent](https://web.nodejs.cn/en-US/docs/Web/API/FetchEvent#examples) 监听器，则可以为用户提供离线体验。

🌐 They can act as a **network proxy** between the page and the external network to perform caching logic or can provide users with an offline experience if the Service Worker adds a [FetchEvent](https://web.nodejs.cn/en-US/docs/Web/API/FetchEvent#examples) listener.

许多使用 Service Workers 的网站只是将它们作为一种透明的优化技术。虽然用户可能会注意到体验更快，但应用的实现并不意识到它们的存在。无论是否启用 Service Workers，运行应用在功能上看起来是相同的。

🌐 Many sites that use Service Workers simply use them as a transparent optimization technique. While users might notice a faster experience, the app's implementation is unaware of their existence. Running the app with or without Service Workers enabled appears functionally equivalent.

## 如何禁用服务工作者

🌐 How to Disable Service Workers

Playwright 允许在测试期间禁用服务工作者。这使得测试更加可预测和高效。但是，如果你的实际页面使用了服务工作者，行为可能会有所不同。

🌐 Playwright allows to disable Service Workers during testing. This makes tests more predictable and performant. However, if your actual page uses a Service Worker, the behavior might be different.

要禁用服务工作者，请将 [testOptions.serviceWorkers](https://playwright.nodejs.cn/docs/api/class-testoptions#test-options-service-workers) 设置为 `'block'`。

🌐 To disable service workers, set [testOptions.serviceWorkers](https://playwright.nodejs.cn/docs/api/class-testoptions#test-options-service-workers) to `'block'`.

playwright.config.ts

```json
import { defineConfig } from '@playwright/test';export default defineConfig({  use: {    serviceWorkers: 'allow'  },});
```

## 访问 Service Worker 并等待激活

🌐 Accessing Service Workers and Waiting for Activation

你可以使用 [browserContext.serviceWorkers()](https://playwright.nodejs.cn/docs/api/class-browsercontext#browser-context-service-workers) 来列出服务 [Worker](https://playwright.nodejs.cn/docs/api/class-worker "Worker")，或者如果你预计某个页面会触发其 [注册](https://web.nodejs.cn/en-US/docs/Web/API/ServiceWorkerContainer/register)，可以专门监听该服务 [Worker](https://playwright.nodejs.cn/docs/api/class-worker "Worker")：

🌐 You can use [browserContext.serviceWorkers()](https://playwright.nodejs.cn/docs/api/class-browsercontext#browser-context-service-workers) to list the Service [Worker](https://playwright.nodejs.cn/docs/api/class-worker "Worker")s, or specifically watch for the Service [Worker](https://playwright.nodejs.cn/docs/api/class-worker "Worker") if you anticipate a page will trigger its [registration](https://web.nodejs.cn/en-US/docs/Web/API/ServiceWorkerContainer/register):

```ts
const serviceWorkerPromise = context.waitForEvent('serviceworker');
await page.goto('/example-with-a-service-worker.html');
const serviceworker = await serviceWorkerPromise;
```

[browserContext.on('serviceworker')](https://playwright.nodejs.cn/docs/api/class-browsercontext#browser-context-event-service-worker) 事件在 Service Worker 接管页面之前触发，因此在使用 [worker.evaluate()](https://playwright.nodejs.cn/docs/api/class-worker#worker-evaluate) 在 worker 中执行之前，你应该等待它的激活。

还有更惯用的等待 Service Worker 被激活的方法，但以下是与实现无关的方法：

🌐 There are more idiomatic methods of waiting for a Service Worker to be activated, but the following is an implementation agnostic method:

```ts
await page.evaluate(async () => {
  const registration = await window.navigator.serviceWorker.getRegistration();  if (registration.active?.state === 'activated')    return;  await new Promise(resolve => {
  window.navigator.serviceWorker.addEventListener('controllerchange', resolve);  });
});
```

## 网络事件和路由

🌐 Network Events and Routing

**Service Worker** 提出的任何网络请求都通过 [BrowserContext](https://playwright.nodejs.cn/docs/api/class-browsercontext "BrowserContext") 对象报告：

🌐 Any network request made by the **Service Worker** is reported through the [BrowserContext](https://playwright.nodejs.cn/docs/api/class-browsercontext "BrowserContext") object:

*   [browserContext.on('request')](https://playwright.nodejs.cn/docs/api/class-browsercontext#browser-context-event-request)、[browserContext.on('requestfinished')](https://playwright.nodejs.cn/docs/api/class-browsercontext#browser-context-event-request-finished)、[browserContext.on('response')](https://playwright.nodejs.cn/docs/api/class-browsercontext#browser-context-event-response) 和 [browserContext.on('requestfailed')](https://playwright.nodejs.cn/docs/api/class-browsercontext#browser-context-event-request-failed) 会被触发
*   [browserContext.route()](https://playwright.nodejs.cn/docs/api/class-browsercontext#browser-context-route) 看到请求
*   [request.serviceWorker()](https://playwright.nodejs.cn/docs/api/class-request#request-service-worker) 将被设置为 Service [Worker](https://playwright.nodejs.cn/docs/api/class-worker "Worker") 实例，而 [request.frame()](https://playwright.nodejs.cn/docs/api/class-request#request-frame) 将会 **抛出**

此外，对于 **Page** 发出的任何网络请求，当请求由 Service Worker 的 fetch 处理程序处理时，方法 [response.fromServiceWorker()](https://playwright.nodejs.cn/docs/api/class-response#response-from-service-worker) 会返回 `true`。

🌐 Additionally, for any network request made by the **Page**, method [response.fromServiceWorker()](https://playwright.nodejs.cn/docs/api/class-response#response-from-service-worker) return `true` when the request was handled a Service Worker's fetch handler.

考虑一个简单的服务工作进程，它会捕获页面发出的每个请求：

🌐 Consider a simple service worker that fetches every request made by the page:

transparent-service-worker.js

```ts
self.addEventListener('fetch', event => {
  // actually make the request  const responsePromise = fetch(event.request);  // send it back to the page  event.respondWith(responsePromise);
});
self.addEventListener('activate', event => {
  event.waitUntil(clients.claim());
});
```

如果 `index.html` 注册了这个服务工作者，然后再获取 `data.json`，将会触发以下请求/响应事件（以及相应的网络生命周期事件）：

🌐 If `index.html` registers this service worker, and then fetches `data.json`, the following Request/Response events would be emitted (along with the corresponding network lifecycle events):

| 事件 | 所有者 | URL | 已路由 | [response.fromServiceWorker()](https://playwright.nodejs.cn/docs/api/class-response#response-from-service-worker) |
| --- | --- | --- | --- | --- |
| [browserContext.on('request')](https://playwright.nodejs.cn/docs/api/class-browsercontext#browser-context-event-request) | [框架] | index.html | 是 |  |
| [page.on('request')](https://playwright.nodejs.cn/docs/api/class-page#page-event-request) | [框架] | index.html | 是 |  |
| [browserContext.on('request')](https://playwright.nodejs.cn/docs/api/class-browsercontext#browser-context-event-request) | 服务 [Worker](https://playwright.nodejs.cn/docs/api/class-worker "Worker") | transparent-service-worker.js | 是 |  |
| [browserContext.on('request')](https://playwright.nodejs.cn/docs/api/class-browsercontext#browser-context-event-request) | 服务 [Worker](https://playwright.nodejs.cn/docs/api/class-worker "Worker") | data.json | 是 |  |
| [browserContext.on('request')](https://playwright.nodejs.cn/docs/api/class-browsercontext#browser-context-event-request) | [框架] | data.json |  | 是 |
| [page.on('request')](https://playwright.nodejs.cn/docs/api/class-page#page-event-request) | [框架] | data.json |  | 是 |

由于示例 Service Worker 只是作为一个基本的透明“代理”

🌐 Since the example Service Worker just acts a basic transparent "proxy":

*   `data.json` 有两个 [browserContext.on('request')](https://playwright.nodejs.cn/docs/api/class-browsercontext#browser-context-event-request) 事件；一个由 [Frame](https://playwright.nodejs.cn/docs/api/class-frame "Frame") 拥有，另一个由 Service [Worker](https://playwright.nodejs.cn/docs/api/class-worker "Worker") 拥有。
*   只有由服务工作进程（Service Worker）拥有的资源请求可以通过 [browserContext.route()](https://playwright.nodejs.cn/docs/api/class-browsercontext#browser-context-route) 路由；由 [Frame](https://playwright.nodejs.cn/docs/api/class-frame "Frame") 拥有的 `data.json` 事件无法路由，因为它们根本没有机会访问外部网络，因为服务工作进程已经注册了 fetch 处理器。

caution

## 仅路由服务工作进程请求

🌐 Routing Service Worker Requests Only

```ts
await context.route('**', async route => {
  if (route.request().serviceWorker()) {
  // NB: calling route.request().frame() here would THROW    await route.fulfill({
  contentType: 'text/plain',      status: 200,      body: 'from sw',    });  } else {
  await route.continue();  }});
```

## 已知限制

🌐 Known Limitations

目前无法路由对更新的 Service Worker 主脚本代码的请求 ([https://github.com/microsoft/playwright/issues/14711)。](https://github.com/microsoft/playwright/issues/14711)%E3%80%82)

🌐 Requests for updated Service Worker main script code currently cannot be routed ([https://github.com/microsoft/playwright/issues/14711](https://github.com/microsoft/playwright/issues/14711)).
