---
title: Untitled
source_url: https://playwright.nodejs.cn/docs/api-testing
fetched_at: 2026-04-29T02:57:28.664Z
---

# Untitled

- 指南API 测试On this pageAPI 测试 ## 介绍​ 🌐 Introduction Playwright 可用于访问你应用的 REST API。 🌐 Playwright can be used to get access to the REST API of your application. 有时你可能希望直接从 Node.js 向服务器发送请求，而不加载页面或在页面中运行 JavaScript 代码。一些可能有用的示例包括： 🌐 Sometimes you may want to send requests to the server directly from Node.js without loading a page and running js code in it. A few examples where it may come in handy: 测试你的服务器 API。

- 在测试中访问 Web 应用之前准备服务器端状态。

- 在浏览器中运行某些操作后验证服务器端后置条件。

所有这些都可以通过 APIRequestContext 方法实现。

🌐 All of that could be achieved via APIRequestContext methods.

## 编写 API 测试​

🌐 Writing API Test

APIRequestContext 可以通过网络发送各种 HTTP(S) 请求。

以下示例演示如何使用 Playwright 通过 GitHub API 测试问题创建。测试套件将执行以下操作：

🌐 The following example demonstrates how to use Playwright to test issues creation via GitHub API. The test suite will do the following:

- 在运行测试之前创建一个新的存储库。

- 创建一些问题并验证服务器状态。

- 运行测试后删除存储库。

### 配置​

🌐 Configuration

GitHub API 需要授权，因此我们将为所有测试配置一次令牌。同时，我们还将设置 baseURL 来简化测试。你可以把它们放在配置文件中，或者在测试文件中使用 test.use()。

🌐 GitHub API requires authorization, so we'll configure the token once for all tests. While at it, we'll also set the baseURL to simplify the tests. You can either put them in the configuration file, or in the test file with test.use().

playwright.config.ts

```
import { defineConfig } from '@playwright/test';
export default defineConfig({  use: {    // All requests we send go to this API endpoint.    baseURL: 'https://api.github.com',    extraHTTPHeaders: {      // We set this header per GitHub guidelines.      'Accept': 'application/vnd.github.v3+json',      // Add authorization token to all requests.      // Assuming personal access token available in the environment.      'Authorization': `token ${process.env.API_TOKEN}`,    },  }});

```

代理配置

如果你的测试需要在代理后运行，你可以在配置中指定这一点，request 夹具会自动识别它：

🌐 If your tests need to run behind a proxy, you can specify this in the config and the request fixture will pick it up automatically:

playwright.config.ts

```
import { defineConfig } from '@playwright/test';
export default defineConfig({  use: {    proxy: {      server: 'http://my-proxy:8080',      username: 'user',      password: 'secret'    },  }});

```

### 编写测试​

🌐 Writing tests

Playwright Test 内置了 request 测试夹具，它会遵循我们指定的 baseURL 或 extraHTTPHeaders 等配置选项，并且可以直接发送一些请求。

🌐 Playwright Test comes with the built-in request fixture that respects configuration options like baseURL or extraHTTPHeaders we specified and is ready to send some requests.

现在我们可以添加一些测试，这些测试将在存储库中创建新问题。

🌐 Now we can add a few tests that will create new issues in the repository.

```
const REPO = 'test-repo-1';
const USER = 'github-username';
test('should create a bug report', async ({ request }) => {  const newIssue = await request.post(`/repos/${USER}/${REPO}/issues`, {    data: {      title: '[Bug] report 1',      body: 'Bug description',    }  });
  expect(newIssue.ok()).toBeTruthy();
  const issues = await request.get(`/repos/${USER}/${REPO}/issues`);
  expect(issues.ok()).toBeTruthy();
  expect(await issues.json()).toContainEqual(expect.objectContaining({    title: '[Bug] report 1',    body: 'Bug description'  }));
});
test('should create a feature request', async ({ request }) => {  const newIssue = await request.post(`/repos/${USER}/${REPO}/issues`, {    data: {      title: '[Feature] request 1',      body: 'Feature description',    }  });
  expect(newIssue.ok()).toBeTruthy();
  const issues = await request.get(`/repos/${USER}/${REPO}/issues`);
  expect(issues.ok()).toBeTruthy();
  expect(await issues.json()).toContainEqual(expect.objectContaining({    title: '[Feature] request 1',    body: 'Feature description'  }));
});

```

### 设置和拆卸​

🌐 Setup and teardown

这些测试假设仓库已经存在。你可能希望在运行测试之前创建一个新的仓库，并在之后删除它。为此，请使用 beforeAll 和 afterAll 钩子。

🌐 These tests assume that repository exists. You probably want to create a new one before running tests and delete it afterwards. Use beforeAll and afterAll hooks for that.

```
test.beforeAll(async ({ request }) => {  // Create a new repository  const response = await request.post('/user/repos', {    data: {      name: REPO    }  });
  expect(response.ok()).toBeTruthy();
});
test.afterAll(async ({ request }) => {  // Delete the repository  const response = await request.delete(`/repos/${USER}/${REPO}`);
  expect(response.ok()).toBeTruthy();
});

```

## 使用请求上下文​

🌐 Using request context

在幕后，request 夹具 实际上会调用 apiRequest.newContext()。如果你想要更多控制，你也可以手动执行。下面是一个独立脚本，它的功能与上面的 beforeAll 和 afterAll 相同。

🌐 Behind the scenes, request fixture will actually call apiRequest.newContext(). You can always do that manually if you'd like more control. Below is a standalone script that does the same as beforeAll and afterAll from above.

```
import { request } from '@playwright/test';
const REPO = 'test-repo-1';
const USER = 'github-username';
(async () => {  // Create a context that will issue http requests.  const context = await request.newContext({    baseURL: 'https://api.github.com',  });
  // Create a repository.  await context.post('/user/repos', {    headers: {      'Accept': 'application/vnd.github.v3+json',      // Add GitHub personal access token.      'Authorization': `token ${process.env.API_TOKEN}`,    },    data: {      name: REPO    }  });
  // Delete a repository.  await context.delete(`/repos/${USER}/${REPO}`, {    headers: {      'Accept': 'application/vnd.github.v3+json',      // Add GitHub personal access token.      'Authorization': `token ${process.env.API_TOKEN}`,    }  });
})();

```

## 从 UI 测试发送 API 请求​

🌐 Sending API requests from UI tests

在浏览器中运行测试时，你可能希望调用应用的 HTTP API。如果你需要在运行测试之前准备服务器状态，或者在浏览器中执行某些操作后检查服务器上的一些后置条件，这可能会很有用。所有这些都可以通过 APIRequestContext 方法实现。

🌐 While running tests inside browsers you may want to make calls to the HTTP API of your application. It may be helpful if you need to prepare server state before running a test or to check some postconditions on the server after performing some actions in the browser. All of that could be achieved via APIRequestContext methods.

### 建立前提条件​

🌐 Establishing preconditions

以下测试通过 API 创建一个新问题，然后导航到项目中所有问题的列表以检查它是否出现在列表顶部。

🌐 The following test creates a new issue via API and then navigates to the list of all issues in the project to check that it appears at the top of the list.

```
import { test, expect } from '@playwright/test';
const REPO = 'test-repo-1';
const USER = 'github-username';
// Request context is reused by all tests in the file.let apiContext;
test.beforeAll(async ({ playwright }) => {  apiContext = await playwright.request.newContext({    // All requests we send go to this API endpoint.    baseURL: 'https://api.github.com',    extraHTTPHeaders: {      // We set this header per GitHub guidelines.      'Accept': 'application/vnd.github.v3+json',      // Add authorization token to all requests.      // Assuming personal access token available in the environment.      'Authorization': `token ${process.env.API_TOKEN}`,    },  });
});
test.afterAll(async ({ }) => {  // Dispose all responses.  await apiContext.dispose();
});
test('last created issue should be first in the list', async ({ page }) => {  const newIssue = await apiContext.post(`/repos/${USER}/${REPO}/issues`, {    data: {      title: '[Feature] request 1',    }  });
  expect(newIssue.ok()).toBeTruthy();
  await page.goto(`https://github.com/${USER}/${REPO}/issues`);
  const firstIssue = page.locator(`a[data-hovercard-type='issue']`).first();
  await expect(firstIssue).toHaveText('[Feature] request 1');
});

```

### 验证后置条件​

🌐 Validating postconditions

以下测试通过浏览器中的用户界面创建一个新问题，然后检查它是否是通过 API 创建的：

🌐 The following test creates a new issue via user interface in the browser and then uses checks if it was created via API:

```
import { test, expect } from '@playwright/test';
const REPO = 'test-repo-1';
const USER = 'github-username';
// Request context is reused by all tests in the file.let apiContext;
test.beforeAll(async ({ playwright }) => {  apiContext = await playwright.request.newContext({    // All requests we send go to this API endpoint.    baseURL: 'https://api.github.com',    extraHTTPHeaders: {      // We set this header per GitHub guidelines.      'Accept': 'application/vnd.github.v3+json',      // Add authorization token to all requests.      // Assuming personal access token available in the environment.      'Authorization': `token ${process.env.API_TOKEN}`,    },  });
});
test.afterAll(async ({ }) => {  // Dispose all responses.  await apiContext.dispose();
});
test('last created issue should be on the server', async ({ page }) => {  await page.goto(`https://github.com/${USER}/${REPO}/issues`);
  await page.getByText('New Issue').click();
  await page.getByRole('textbox', { name: 'Title' }).fill('Bug report 1');
  await page.getByRole('textbox', { name: 'Comment body' }).fill('Bug description');
  await page.getByText('Submit new issue').click();
  const issueId = new URL(page.url()).pathname.split('/').pop();
  const newIssue = await apiContext.get(      `https://api.github.com/repos/${USER}/${REPO}/issues/${issueId}`  );
  expect(newIssue.ok()).toBeTruthy();
  expect(newIssue.json()).toEqual(expect.objectContaining({    title: 'Bug report 1'  }));
});

```

## 重用身份验证状态​

🌐 Reusing authentication state

Web 应用使用基于 Cookie 或基于令牌的身份验证，其中已认证的状态存储为 cookies。Playwright 提供了 apiRequestContext.storageState() 方法，可用于从已认证的上下文中检索存储状态，然后使用该状态创建新的上下文。

🌐 Web apps use cookie-based or token-based authentication, where authenticated state is stored as cookies. Playwright provides apiRequestContext.storageState() method that can be used to retrieve storage state from an authenticated context and then create new contexts with that state.

存储状态在 BrowserContext 和 APIRequestContext 之间是可以互换的。你可以使用它通过 API 调用登录，然后创建一个已经包含这些 cookie 的新上下文。以下代码片段展示了如何从已认证的 APIRequestContext 获取状态，并使用该状态创建一个新的 BrowserContext。

🌐 Storage state is interchangeable between BrowserContext and APIRequestContext. You can use it to log in via API calls and then create a new context with cookies already there. The following code snippet retrieves state from an authenticated APIRequestContext and creates a new BrowserContext with that state.

```
const requestContext = await request.newContext({  httpCredentials: {    username: 'user',    password: 'passwd'  }});
await requestContext.get(`https://api.example.com/login`);
// Save storage state into the file.await requestContext.storageState({ path: 'state.json' });
// Create a new context with the saved storage state.const context = await browser.newContext({ storageState: 'state.json' });

```

## 上下文请求与全局请求​

🌐 Context request vs global request

有两种类型的 APIRequestContext：

🌐 There are two types of APIRequestContext:

- 与 BrowserContext 关联

- 通过 apiRequest.newContext() 创建的孤立实例

主要的区别在于，通过 browserContext.request 和 page.request 访问的 APIRequestContext 会使用浏览器上下文填充请求的 Cookie 头，并且如果 APIResponse 包含 Set-Cookie 头，它会自动更新浏览器的 Cookie：

🌐 The main difference is that APIRequestContext accessible via browserContext.request and page.request will populate request's Cookie header from the browser context and will automatically update browser cookies if APIResponse has Set-Cookie header:

```
test('context request will share cookie storage with its browser context', async ({  page,  context,}) => {  await context.route('https://www.github.com/', async route => {    // Send an API request that shares cookie storage with the browser context.    const response = await context.request.fetch(route.request());
    const responseHeaders = response.headers();
    // The response will have 'Set-Cookie' header.    const responseCookies = new Map(responseHeaders['set-cookie']        .split('\n')        .map(c => c.split(';
', 2)[0].split('=')));
    // The response will have 3 cookies in 'Set-Cookie' header.    expect(responseCookies.size).toBe(3);
    const contextCookies = await context.cookies();
    // The browser context will already contain all the cookies from the API response.    expect(new Map(contextCookies.map(({ name, value }) =>      [name, value])    )).toEqual(responseCookies);
    await route.fulfill({      response,      headers: { ...responseHeaders, foo: 'bar' },    });
  });
  await page.goto('https://www.github.com/');
});

```

如果你不希望 APIRequestContext 使用和更新浏览器上下文中的 Cookie，你可以手动创建一个新的 APIRequestContext 实例，它将拥有自己独立的 Cookie：

🌐 If you don't want APIRequestContext to use and update cookies from the browser context, you can manually create a new instance of APIRequestContext which will have its own isolated cookies:

```
test('global context request has isolated cookie storage', async ({  page,  context,  browser,  playwright}) => {  // Create a new instance of APIRequestContext with isolated cookie storage.  const request = await playwright.request.newContext();
  await context.route('https://www.github.com/', async route => {    const response = await request.fetch(route.request());
    const responseHeaders = response.headers();
    const responseCookies = new Map(responseHeaders['set-cookie']        .split('\n')        .map(c => c.split(';
', 2)[0].split('=')));
    // The response will have 3 cookies in 'Set-Cookie' header.    expect(responseCookies.size).toBe(3);
    const contextCookies = await context.cookies();
    // The browser context will not have any cookies from the isolated API request.    expect(contextCookies.length).toBe(0);
    // Manually export cookie storage.    const storageState = await request.storageState();
    // Create a new context and initialize it with the cookies from the global request.    const browserContext2 = await browser.newContext({ storageState });
    const contextCookies2 = await browserContext2.cookies();
    // The new browser context will already contain all the cookies from the API response.    expect(        new Map(contextCookies2.map(({ name, value }) => [name, value]))    ).toEqual(responseCookies);
    await route.fulfill({      response,      headers: { ...responseHeaders, foo: 'bar' },    });
  });
  await page.goto('https://www.github.com/');
  await request.dispose();
});

```
