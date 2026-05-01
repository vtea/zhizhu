---
title: 网络
source_url: https://playwright.nodejs.cn/docs/network
fetched_at: 2026-04-29T02:57:28.664Z
---

# 网络

## 介绍

🌐 Introduction

Playwright 提供了用于**监控**和**修改**浏览器网络流量（包括 HTTP 和 HTTPS）的 API。页面发出的任何请求，包括 [XHR](https://web.nodejs.cn/en-US/docs/Web/API/XMLHttpRequest) 和 [fetch](https://web.nodejs.cn/en-US/docs/Web/API/Fetch_API) 请求，都可以被跟踪、修改和处理。

🌐 Playwright provides APIs to **monitor** and **modify** browser network traffic, both HTTP and HTTPS. Any requests that a page does, including [XHRs](https://web.nodejs.cn/en-US/docs/Web/API/XMLHttpRequest) and [fetch](https://web.nodejs.cn/en-US/docs/Web/API/Fetch_API) requests, can be tracked, modified and handled.

## 模拟 API

🌐 Mock APIs

查看我们的[API 模拟指南](https://playwright.nodejs.cn/docs/mock)以了解更多相关信息

🌐 Check out our [API mocking guide](https://playwright.nodejs.cn/docs/mock) to learn more on how to

*   模拟 API 请求并且从不访问 API
*   执行 API 请求并修改响应
*   使用 HAR 文件来模拟网络请求。

## 网络模拟

🌐 Network mocking

你无需配置任何内容就可以模拟网络请求。只需定义一个自定义的 [Route](https://playwright.nodejs.cn/docs/api/class-route "Route") 来为浏览器上下文模拟网络即可。

🌐 You don't have to configure anything to mock network requests. Just define a custom [Route](https://playwright.nodejs.cn/docs/api/class-route "Route") that mocks network for a browser context.

example.spec.ts

```ts
import { test, expect } from '@playwright/test';
test.beforeEach(async ({ context }) => {
  // Block any css requests for each test in this file.  await context.route(/.css$/, route => route.abort());
});
test('loads page without css', async ({ page }) => {
  await page.goto('https://playwright.nodejs.cn');  // ... test goes here});
```

或者，你可以使用 [page.route()](https://playwright.nodejs.cn/docs/api/class-page#page-route) 在单个页面中模拟网络请求。

🌐 Alternatively, you can use [page.route()](https://playwright.nodejs.cn/docs/api/class-page#page-route) to mock network in a single page.

example.spec.ts

```ts
import { test, expect } from '@playwright/test';
test('loads page without images', async ({ page }) => {
  // Block png and jpeg images.  await page.route(/(png|jpeg)$/, route => route.abort());  await page.goto('https://playwright.nodejs.cn');  // ... test goes here});
```

## HTTP 认证

🌐 HTTP Authentication

执行 HTTP 身份验证。

🌐 Perform HTTP Authentication.

*   Test
*   Library

playwright.config.ts

```json
import { defineConfig } from '@playwright/test';export default defineConfig({  use: {    httpCredentials: {      username: 'bill',      password: 'pa55w0rd',    }  }});
```

## HTTP 代理

🌐 HTTP Proxy

你可以配置页面通过 HTTP(S) 代理或 SOCKSv5 加载。代理可以为整个浏览器全局设置，也可以单独为每个浏览器上下文设置。

🌐 You can configure pages to load over the HTTP(S) proxy or SOCKSv5. Proxy can be either set globally for the entire browser, or for each browser context individually.

你可以选择为 HTTP(S) 代理指定用户名和密码，也可以指定要绕过代理的主机。

🌐 You can optionally specify username and password for HTTP(S) proxy, you can also specify hosts to bypass the [proxy](https://playwright.nodejs.cn/docs/api/class-browser#browser-new-context-option-proxy) for.

这是全局代理的示例：

🌐 Here is an example of a global proxy:

*   Test
*   Library

playwright.config.ts

```json
import { defineConfig } from '@playwright/test';export default defineConfig({  use: {    proxy: {      server: 'http://myproxy.com:3128',      username: 'usr',      password: 'pwd'    }  }});
```

也可以按上下文指定它：

🌐 Its also possible to specify it per context:

*   Test
*   Library

example.spec.ts

```json
import { test, expect } from '@playwright/test';test('should use custom proxy on a new context', async ({ browser }) => {  const context = await browser.newContext({    proxy: {      server: 'http://myproxy.com:3128',    }  });  const page = await context.newPage();  await context.close();});
```

## 网络事件

🌐 Network events

你可以监控所有的 [请求] 和 [响应]：

🌐 You can monitor all the [Request](https://playwright.nodejs.cn/docs/api/class-request "Request")s and [Response](https://playwright.nodejs.cn/docs/api/class-response "Response")s:

```ts
// Subscribe to 'request' and 'response' events.page.on('request', request => console.log('>>', request.method(), request.url()));
page.on('response', response => console.log('<<', response.status(), response.url()));
await page.goto('https://example.com');
```

或者在按钮点击后使用 [page.waitForResponse()](https://playwright.nodejs.cn/docs/api/class-page#page-wait-for-response) 等待网络响应：

🌐 Or wait for a network response after the button click with [page.waitForResponse()](https://playwright.nodejs.cn/docs/api/class-page#page-wait-for-response):

```ts
// Use a glob URL pattern. Note no await.const responsePromise = page.waitForResponse('**/api/fetch_data');
await page.getByText('Update').click();
const response = await responsePromise;
```

#### 变化

🌐 Variations

等待使用 [page.waitForResponse()](https://playwright.nodejs.cn/docs/api/class-page#page-wait-for-response) 的 [Response](https://playwright.nodejs.cn/docs/api/class-response "Response")

🌐 Wait for [Response](https://playwright.nodejs.cn/docs/api/class-response "Response")s with [page.waitForResponse()](https://playwright.nodejs.cn/docs/api/class-page#page-wait-for-response)

```ts
// Use a RegExp. Note no await.const responsePromise = page.waitForResponse(/\.jpeg$/);
await page.getByText('Update').click();
const response = await responsePromise;
// Use a predicate taking a Response object. Note no await.const responsePromise = page.waitForResponse(response => response.url().includes(token));
await page.getByText('Update').click();
const response = await responsePromise;
```

## 处理请求

🌐 Handle requests

```ts
await page.route('**/api/fetch_data', route => route.fulfill({
  status: 200,  body: testData,}));
await page.goto('https://example.com');
```

你可以通过处理 Playwright 脚本中的网络请求来模拟 API 端点。

🌐 You can mock API endpoints via handling the network requests in your Playwright script.

#### 变化

🌐 Variations

使用 [browserContext.route()](https://playwright.nodejs.cn/docs/api/class-browsercontext#browser-context-route) 在整个浏览器上下文中设置路由，或使用 [page.route()](https://playwright.nodejs.cn/docs/api/class-page#page-route) 在页面中设置路由。它将应用于弹出窗口和打开的链接。

🌐 Set up route on the entire browser context with [browserContext.route()](https://playwright.nodejs.cn/docs/api/class-browsercontext#browser-context-route) or page with [page.route()](https://playwright.nodejs.cn/docs/api/class-page#page-route). It will apply to popup windows and opened links.

```ts
await browserContext.route('**/api/login', route => route.fulfill({
  status: 200,  body: 'accept',}));
await page.goto('https://example.com');
```

## 修改请求

🌐 Modify requests

```ts
// Delete headerawait page.route('**/*', async route => {
  const headers = route.request().headers();  delete headers['X-Secret'];  await route.continue({ headers });
});
// Continue requests as POST.await page.route('**/*', route => route.continue({ method: 'POST' }));
```

你可以继续发送带有修改的请求。上面的例子是从发送的请求中移除一个 HTTP 头。

🌐 You can continue requests with modifications. Example above removes an HTTP header from the outgoing requests.

## 中止请求

🌐 Abort requests

你可以使用 [page.route()](https://playwright.nodejs.cn/docs/api/class-page#page-route) 和 [route.abort()](https://playwright.nodejs.cn/docs/api/class-route#route-abort) 来中止请求。

🌐 You can abort requests using [page.route()](https://playwright.nodejs.cn/docs/api/class-page#page-route) and [route.abort()](https://playwright.nodejs.cn/docs/api/class-route#route-abort).

```ts
await page.route('**/*.{png,jpg,jpeg}', route => route.abort());
// Abort based on the request typeawait page.route('**/*', route => {
  return route.request().resourceType() === 'image' ? route.abort() : route.continue();
});
```

## 修改响应

🌐 Modify responses

要修改响应，请使用 [APIRequestContext](https://playwright.nodejs.cn/docs/api/class-apirequestcontext "APIRequestContext") 获取原始响应，然后将响应传递给 [route.fulfill()](https://playwright.nodejs.cn/docs/api/class-route#route-fulfill)。你可以通过选项覆盖响应中的各个字段：

🌐 To modify a response use [APIRequestContext](https://playwright.nodejs.cn/docs/api/class-apirequestcontext "APIRequestContext") to get the original response and then pass the response to [route.fulfill()](https://playwright.nodejs.cn/docs/api/class-route#route-fulfill). You can override individual fields on the response via options:

```json
await page.route('**/title.html', async route => {  // Fetch original response.  const response = await route.fetch();  // Add a prefix to the title.  let body = await response.text();  body = body.replace('<title>', '<title>My prefix:');  await route.fulfill({    // Pass all fields from the response.    response,    // Override response body.    body,    // Force content type to be html.    headers: {      ...response.headers(),      'content-type': 'text/html'    }  });});
```

## Glob URL 模式

🌐 Glob URL patterns

Playwright 在网络拦截方法中（如 [page.route()](https://playwright.nodejs.cn/docs/api/class-page#page-route) 或 [page.waitForResponse()](https://playwright.nodejs.cn/docs/api/class-page#page-wait-for-response)）使用简化的全局匹配模式来匹配 URL。这些模式支持基本的通配符：

🌐 Playwright uses simplified glob patterns for URL matching in network interception methods like [page.route()](https://playwright.nodejs.cn/docs/api/class-page#page-route) or [page.waitForResponse()](https://playwright.nodejs.cn/docs/api/class-page#page-wait-for-response). These patterns support basic wildcards:

1.   星号： 
    *   单个 `*` 匹配除 `/` 之外的任意字符
    *   双重 `**` 匹配包括 `/` 在内的任意字符

2.   问号 `?` 只匹配问号 `?`。如果你想匹配任意字符，请使用 `*`。
3.   大括号 `{}` 可用于匹配由逗号分隔的选项列表 `,`
4.   反斜杠 `\` 可用于转义任何特殊字符（注意，如果要转义反斜杠本身，则写作 `\\`）

示例：

🌐 Examples:

*   `https://example.com/*.js` 匹配 `https://example.com/file.js` 但不匹配 `https://example.com/path/file.js`
*   `https://example.com/?page=1` 匹配 `https://example.com/?page=1` 但不匹配 `https://example.com`
*   `**/*.js` 同时匹配 `https://example.com/file.js` 和 `https://example.com/path/file.js`
*   `**/*.{png,jpg,jpeg}` 匹配所有图片请求

重要说明：

🌐 Important notes:

*   glob 模式必须匹配整个 URL，而不仅仅是其中的一部分。
*   使用 glob 进行 URL 匹配时，请考虑完整的 URL 结构，包括协议和路径分隔符。
*   对于更复杂的匹配要求，请考虑使用 [RegExp](https://web.nodejs.cn/en-US/docs/Web/JavaScript/Reference/Global_Objects/RegExp "RegExp") 而不是 glob 模式。

## WebSockets

Playwright 原生支持 [WebSockets](https://web.nodejs.cn/en-US/docs/Web/API/WebSockets_API) 的检查、模拟和修改。请参阅我们的 [API 模拟指南](https://playwright.nodejs.cn/docs/mock#mock-websockets) 了解如何模拟 WebSockets。

🌐 Playwright supports [WebSockets](https://web.nodejs.cn/en-US/docs/Web/API/WebSockets_API) inspection, mocking and modifying out of the box. See our [API mocking guide](https://playwright.nodejs.cn/docs/mock#mock-websockets) to learn how to mock WebSockets.

每次创建 WebSocket 时，都会触发 [page.on('websocket')](https://playwright.nodejs.cn/docs/api/class-page#page-event-web-socket) 事件。该事件包含 [WebSocket](https://playwright.nodejs.cn/docs/api/class-websocket "WebSocket") 实例，可用于进一步检查 WebSocket 帧：

🌐 Every time a WebSocket is created, the [page.on('websocket')](https://playwright.nodejs.cn/docs/api/class-page#page-event-web-socket) event is fired. This event contains the [WebSocket](https://playwright.nodejs.cn/docs/api/class-websocket "WebSocket") instance for further web socket frames inspection:

```ts
page.on('websocket', ws => {
  console.log(`WebSocket opened: ${ws.url()}>`);  ws.on('framesent', event => console.log(event.payload));  ws.on('framereceived', event => console.log(event.payload));  ws.on('close', () => console.log('WebSocket closed'));
});
```

## 缺少网络事件和 Service Worker

🌐 Missing Network Events and Service Workers

Playwright 内置的 [browserContext.route()](https://playwright.nodejs.cn/docs/api/class-browsercontext#browser-context-route) 和 [page.route()](https://playwright.nodejs.cn/docs/api/class-page#page-route) 允许你的测试原生路由请求，并执行模拟和拦截。

🌐 Playwright's built-in [browserContext.route()](https://playwright.nodejs.cn/docs/api/class-browsercontext#browser-context-route) and [page.route()](https://playwright.nodejs.cn/docs/api/class-page#page-route) allow your tests to natively route requests and perform mocking and interception.

如果你正在使用 Playwright 的原生 [browserContext.route()](https://playwright.nodejs.cn/docs/api/class-browsercontext#browser-context-route) 和 [page.route()](https://playwright.nodejs.cn/docs/api/class-page#page-route)，并且发现网络事件缺失，请通过将 [serviceWorkers](https://playwright.nodejs.cn/docs/api/class-browser#browser-new-context-option-service-workers) 设置为 `'block'` 来禁用 Service Worker。

🌐 If you're using Playwright's native [browserContext.route()](https://playwright.nodejs.cn/docs/api/class-browsercontext#browser-context-route) and [page.route()](https://playwright.nodejs.cn/docs/api/class-page#page-route), and it appears network events are missing, disable Service Workers by setting [serviceWorkers](https://playwright.nodejs.cn/docs/api/class-browser#browser-new-context-option-service-workers) to `'block'`.

可能是你正在使用像 Mock Service Worker (MSW) 这样的模拟工具。虽然该工具开箱即用即可模拟响应，但它会添加自己的 Service Worker 来接管网络请求，从而使这些请求对 [browserContext.route()](https://playwright.nodejs.cn/docs/api/class-browsercontext#browser-context-route) 和 [page.route()](https://playwright.nodejs.cn/docs/api/class-page#page-route) 不可见。如果你对网络测试和模拟都感兴趣，建议使用内置的 [browserContext.route()](https://playwright.nodejs.cn/docs/api/class-browsercontext#browser-context-route) 和 [page.route()](https://playwright.nodejs.cn/docs/api/class-page#page-route) 进行 [响应模拟](http://playwright.nodejs.cn/docs/network#handle-requests)。

🌐 It might be that you are using a mock tool such as Mock Service Worker (MSW). While this tool works out of the box for mocking responses, it adds its own Service Worker that takes over the network requests, hence making them invisible to [browserContext.route()](https://playwright.nodejs.cn/docs/api/class-browsercontext#browser-context-route) and [page.route()](https://playwright.nodejs.cn/docs/api/class-page#page-route). If you are interested in both network testing and mocking, consider using built-in [browserContext.route()](https://playwright.nodejs.cn/docs/api/class-browsercontext#browser-context-route) and [page.route()](https://playwright.nodejs.cn/docs/api/class-page#page-route) for [response mocking](http://playwright.nodejs.cn/docs/network#handle-requests).

如果你感兴趣的不仅是使用 Service Workers 来进行测试和网络模拟，而是对 Service Workers 自身发出的请求进行路由和监听，请参阅 [本指南](https://playwright.nodejs.cn/docs/service-workers)。
