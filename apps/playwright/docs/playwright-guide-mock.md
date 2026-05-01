---
title: 模拟 API
source_url: https://playwright.nodejs.cn/docs/mock
fetched_at: 2026-04-29T02:57:28.664Z
---

# 模拟 API

🌐 Introduction

Web API 通常以 HTTP 端点的形式实现。Playwright 提供了用于 **模拟** 和 **修改** 网络流量的 API，包括 HTTP 和 HTTPS。页面发出的任何请求，包括 [XHR](https://web.nodejs.cn/en-US/docs/Web/API/XMLHttpRequest) 和 [fetch](https://web.nodejs.cn/en-US/docs/Web/API/Fetch_API) 请求，都可以被跟踪、修改和模拟。使用 Playwright，你还可以通过包含页面发出的多个网络请求的 HAR 文件来进行模拟。

🌐 Web APIs are usually implemented as HTTP endpoints. Playwright provides APIs to **mock** and **modify** network traffic, both HTTP and HTTPS. Any requests that a page does, including [XHRs](https://web.nodejs.cn/en-US/docs/Web/API/XMLHttpRequest) and [fetch](https://web.nodejs.cn/en-US/docs/Web/API/Fetch_API) requests, can be tracked, modified and mocked. With Playwright you can also mock using HAR files that contain multiple network requests made by the page.

## 模拟 API 请求

🌐 Mock API requests

以下代码将拦截对 `*/**/api/v1/fruits` 的所有调用，并返回自定义响应。不会向 API 发出任何请求。测试会访问使用模拟路由的 URL，并断言页面上存在模拟数据。

🌐 The following code will intercept all the calls to `*/**/api/v1/fruits` and will return a custom response instead. No requests to the API will be made. The test goes to the URL that uses the mocked route and asserts that mock data is present on the page.

```ts
test("mocks a fruit and doesn't call api", async ({ page }) => {
  // Mock the api call before navigating  await page.route('*/**/api/v1/fruits', async route => {
  const json = [{ name: 'Strawberry', id: 21 }];    await route.fulfill({ json });  });  // Go to the page  await page.goto('https://demo.playwright.dev/api-mocking');  // Assert that the Strawberry fruit is visible  await expect(page.getByText('Strawberry')).toBeVisible();
});
```

从示例测试的跟踪中可以看到，API 从未被调用，但它确实使用了模拟数据完成。 ![Image 1: api mocking trace](https://github.com/microsoft/playwright/assets/13063165/3dc14cbf-c100-4efc-ac21-d7b52d698b53)

🌐 You can see from the trace of the example test that the API was never called, it was however fulfilled with the mock data. ![Image 2: api mocking trace](https://github.com/microsoft/playwright/assets/13063165/3dc14cbf-c100-4efc-ac21-d7b52d698b53)

查看更多关于[高级网络](https://playwright.nodejs.cn/docs/network)的信息。

🌐 Read more about [advanced networking](https://playwright.nodejs.cn/docs/network).

## 修改 API 响应

🌐 Modify API responses

有时，发起 API 请求是必要的，但响应需要经过修补以便进行可重复的测试。在这种情况下，可以不模拟请求，而是实际执行请求，并使用修改后的响应来完成它。

🌐 Sometimes, it is essential to make an API request, but the response needs to be patched to allow for reproducible testing. In that case, instead of mocking the request, one can perform the request and fulfill it with the modified response.

在下面的示例中，我们拦截对水果 API 的调用，并向数据中添加一种名为“枇杷”的新水果。然后我们访问该 URL，并断言这些数据存在：

🌐 In the example below we intercept the call to the fruit API and add a new fruit called 'Loquat', to the data. We then go to the url and assert that this data is there:

```ts
test('gets the json from api and adds a new fruit', async ({ page }) => {
  // Get the response and add to it  await page.route('*/**/api/v1/fruits', async route => {
  const response = await route.fetch();    const json = await response.json();    json.push({ name: 'Loquat', id: 100 });    // Fulfill using the original response, while patching the response body    // with the given JSON object.    await route.fulfill({ response, json });  });  // Go to the page  await page.goto('https://demo.playwright.dev/api-mocking');  // Assert that the new fruit is visible  await expect(page.getByText('Loquat', { exact: true })).toBeVisible();
});
```

在我们的测试跟踪中，我们可以看到 API 已被调用并且响应已被修改。 ![Image 3: trace of test showing api being called and fulfilled](https://github.com/microsoft/playwright/assets/13063165/8b8dd82d-1b3e-428e-871b-840581fed439)

🌐 In the trace of our test we can see that the API was called and the response was modified. ![Image 4: trace of test showing api being called and fulfilled](https://github.com/microsoft/playwright/assets/13063165/8b8dd82d-1b3e-428e-871b-840581fed439)

通过检查响应，我们可以看到我们的新水果已被添加到列表中。 ![Image 5: trace of test showing the mock response](https://github.com/microsoft/playwright/assets/13063165/03e6c87c-4ecc-47e8-9ca0-30fface25e9d)

🌐 By inspecting the response we can see that our new fruit was added to the list. ![Image 6: trace of test showing the mock response](https://github.com/microsoft/playwright/assets/13063165/03e6c87c-4ecc-47e8-9ca0-30fface25e9d)

查看更多关于[高级网络](https://playwright.nodejs.cn/docs/network)的信息。

🌐 Read more about [advanced networking](https://playwright.nodejs.cn/docs/network).

## 使用 HAR 文件进行模拟

🌐 Mocking with HAR files

HAR 文件是一个 [HTTP Archive](http://www.softwareishard.com/blog/har-12-spec/) 文件，其中包含页面加载时发出的所有网络请求的记录。它包含有关请求和响应头、Cookie、内容、时间信息等的数据。你可以使用 HAR 文件在测试中模拟网络请求。你需要：

🌐 A HAR file is an [HTTP Archive](http://www.softwareishard.com/blog/har-12-spec/) file that contains a record of all the network requests that are made when a page is loaded. It contains information about the request and response headers, cookies, content, timings, and more. You can use HAR files to mock network requests in your tests. You'll need to:

1.   录制 HAR 文件。
2.   与测试一起提交 HAR 文件。
3.   使用测试中保存的 HAR 文件路由请求。

### 录制 HAR 文件

🌐 Recording a HAR file

要记录 HAR 文件，我们使用 [page.routeFromHAR()](https://playwright.nodejs.cn/docs/api/class-page#page-route-from-har) 或 [browserContext.routeFromHAR()](https://playwright.nodejs.cn/docs/api/class-browsercontext#browser-context-route-from-har) 方法。该方法接收 HAR 文件的路径以及一个可选的选项对象。选项对象可以包含 URL，这样只有与指定的通配符模式匹配的请求才会从 HAR 文件中提供。如果未指定，则所有请求都会从 HAR 文件中提供。

🌐 To record a HAR file we use [page.routeFromHAR()](https://playwright.nodejs.cn/docs/api/class-page#page-route-from-har) or [browserContext.routeFromHAR()](https://playwright.nodejs.cn/docs/api/class-browsercontext#browser-context-route-from-har) method. This method takes in the path to the HAR file and an optional object of options. The options object can contain the URL so that only requests with the URL matching the specified glob pattern will be served from the HAR File. If not specified, all requests will be served from the HAR file.

将 `update` 选项设置为 true 将使用实际的网络信息创建或更新 HAR 文件，而不是从 HAR 文件中提供请求。在创建测试以填充 HAR 文件真实数据时使用此选项。

🌐 Setting `update` option to true will create or update the HAR file with the actual network information instead of serving the requests from the HAR file. Use it when creating a test to populate the HAR with real data.

另外，你也可以在创建浏览器上下文时，通过在 [browser.newContext()](https://playwright.nodejs.cn/docs/api/class-browser#browser-new-context) 中使用 [recordHar](https://playwright.nodejs.cn/docs/api/class-browser#browser-new-context-option-record-har) 选项来记录 HAR 文件。这可以让你在上下文关闭之前捕获整个上下文的所有网络流量。

### 修改 HAR 文件

🌐 Modifying a HAR file

一旦你录制了 HAR 文件，你可以通过打开 'hars' 文件夹中的哈希 .txt 文件并编辑 JSON 来修改它。这个文件应当被提交到你的源代码管理中。每次你使用 `update: true` 运行这个测试时，它都会使用 API 的请求更新你的 HAR 文件。

🌐 Once you have recorded a HAR file you can modify it by opening the hashed .txt file inside your 'hars' folder and editing the JSON. This file should be committed to your source control. Anytime you run this test with `update: true` it will update your HAR file with the request from the API.

```json
[  {    "name": "Playwright",    "id": 100  },  // ... other fruits]
```

### 从 HAR 重播

🌐 Replaying from HAR

现在你已经记录了 HAR 文件并修改了模拟数据，它可以在测试中用来提供匹配的响应。为此，只需关闭或简单地删除 `update` 选项。这将使测试针对 HAR 文件运行，而不是访问 API。

🌐 Now that you have the HAR file recorded and modified the mock data, it can be used to serve matching responses in the test. For this, just turn off or simply remove the `update` option. This will run the test against the HAR file instead of hitting the API.

```ts
test('gets the json from HAR and checks the new fruit has been added', async ({ page }) => {
  // Replay API requests from HAR.  // Either use a matching response from the HAR,  // or abort the request if nothing matches.  await page.routeFromHAR('./hars/fruit.har', {
  url: '*/**/api/v1/fruits',    update: false,  });  // Go to the page  await page.goto('https://demo.playwright.dev/api-mocking');  // Assert that the Playwright fruit is visible  await expect(page.getByText('Playwright', { exact: true })).toBeVisible();
});
```

在我们的测试追踪中，我们可以看到该路由是从 HAR 文件中完成的，而 API 并未被调用。![Image 7: trace showing the HAR file being used](https://github.com/microsoft/playwright/assets/13063165/1bd7ab66-ea4f-43c2-a4e5-ca17d4837ff1)

🌐 In the trace of our test we can see that the route was fulfilled from the HAR file and the API was not called. ![Image 8: trace showing the HAR file being used](https://github.com/microsoft/playwright/assets/13063165/1bd7ab66-ea4f-43c2-a4e5-ca17d4837ff1)

如果我们检查响应，就可以看到我们的新水果已被添加到 JSON 中，这是通过手动更新 `hars` 文件夹内的哈希文件 `.txt` 完成的。 ![Image 9: trace showing response from HAR file](https://github.com/microsoft/playwright/assets/13063165/db3117fc-7b02-4973-9a51-29e213261a6a)

🌐 If we inspect the response we can see our new fruit was added to the JSON, which was done by manually updating the hashed `.txt` file inside the `hars` folder. ![Image 10: trace showing response from HAR file](https://github.com/microsoft/playwright/assets/13063165/db3117fc-7b02-4973-9a51-29e213261a6a)

HAR会严格匹配URL和HTTP方法。对于POST请求，它还会严格匹配POST负载。如果有多个记录匹配同一请求，将选择具有最多匹配头的记录。产生重定向的条目将会被自动跟随。

🌐 HAR replay matches URL and HTTP method strictly. For POST requests, it also matches POST payloads strictly. If multiple recordings match a request, the one with the most matching headers is picked. An entry resulting in a redirect will be followed automatically.

类似于录制时，如果给定的 HAR 文件名以 `.zip` 结尾，则被视为包含 HAR 文件和作为单独条目存储的网络有效负载的归档。你也可以解压该归档，手动编辑有效负载或 HAR 日志，并指向解压后的 HAR 文件。所有有效负载都会相对于文件系统上的解压 HAR 文件进行解析。

🌐 Similar to when recording, if given HAR file name ends with `.zip`, it is considered an archive containing the HAR file along with network payloads stored as separate entries. You can also extract this archive, edit payloads or HAR log manually and point to the extracted har file. All the payloads will be resolved relative to the extracted har file on the file system.

#### 使用 CLI 记录 HAR

🌐 Recording HAR with CLI

我们建议使用 `update` 选项来记录你的测试的 HAR 文件。但你也可以使用 Playwright CLI 记录 HAR 文件。

🌐 We recommend the `update` option to record HAR file for your test. However, you can also record the HAR with Playwright CLI.

使用 Playwright CLI 打开浏览器，并传递 `--save-har` 选项以生成 HAR 文件。可选择使用 `--save-har-glob` 仅保存你感兴趣的请求，例如 API 端点。如果 har 文件名以 `.zip` 结尾，工件将作为单独的文件写入，并全部压缩到一个 `zip` 中。

🌐 Open the browser with Playwright CLI and pass `--save-har` option to produce a HAR file. Optionally, use `--save-har-glob` to only save requests you are interested in, for example API endpoints. If the har file name ends with `.zip`, artifacts are written as separate files and are all compressed into a single `zip`.

```
# Save API requests from example.com as "example.har" archive.npx playwright open --save-har=example.har --save-har-glob="**/api/**" https://example.com
```

查看更多关于[高级网络](https://playwright.nodejs.cn/docs/network)的信息。

🌐 Read more about [advanced networking](https://playwright.nodejs.cn/docs/network).

## 模拟 WebSockets

🌐 Mock WebSockets

以下代码将拦截 WebSocket 连接，并模拟整个 WebSocket 通信，而不是连接到服务器。此示例用 `"response"` 响应 `"request"`。

🌐 The following code will intercept WebSocket connections and mock entire communication over the WebSocket, instead of connecting to the server. This example responds to a `"request"` with a `"response"`.

```ts
await page.routeWebSocket('wss://example.com/ws', ws => {
  ws.onMessage(message => {
  if (message === 'request')      ws.send('response');  });
});
```

或者，你可能想要连接到实际的服务器，但在中间拦截消息并进行修改或阻止。下面是一个示例，它修改页面发送到服务器的一些消息，其余的保持不变。

🌐 Alternatively, you may want to connect to the actual server, but intercept messages in-between and modify or block them. Here is an example that modifies some of the messages sent by the page to the server, and leaves the rest unmodified.

```ts
await page.routeWebSocket('wss://example.com/ws', ws => {
  const server = ws.connectToServer();  ws.onMessage(message => {
  if (message === 'request')      server.send('request2');    else      server.send(message);  });
});
```

欲了解更多详情，请参阅 [WebSocketRoute](https://playwright.nodejs.cn/docs/api/class-websocketroute "WebSocketRoute")。

🌐 For more details, see [WebSocketRoute](https://playwright.nodejs.cn/docs/api/class-websocketroute "WebSocketRoute").
