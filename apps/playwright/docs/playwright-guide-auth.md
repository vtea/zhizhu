---
title: 验证
source_url: https://playwright.nodejs.cn/docs/auth
fetched_at: 2026-04-29T02:57:28.664Z
---

# 验证

## 介绍

🌐 Introduction

Playwright 在称为 [浏览器上下文](https://playwright.nodejs.cn/docs/browser-contexts) 的隔离环境中执行测试。这种隔离模型提高了可重复性并防止了连锁测试失败。测试可以加载已有的认证状态，这消除了每次测试都进行认证的需求，并加快了测试执行速度。

🌐 Playwright executes tests in isolated environments called [browser contexts](https://playwright.nodejs.cn/docs/browser-contexts). This isolation model improves reproducibility and prevents cascading test failures. Tests can load existing authenticated state. This eliminates the need to authenticate in every test and speeds up test execution.

## 核心理念

🌐 Core concepts

无论你选择哪种身份验证策略，你都可能将经过身份验证的浏览器状态存储在文件系统上。

🌐 Regardless of the authentication strategy you choose, you are likely to store authenticated browser state on the file system.

我们建议创建 `playwright/.auth` 目录并将其添加到你的 `.gitignore` 中。你的认证程序将生成已认证的浏览器状态并将其保存到该 `playwright/.auth` 目录中的文件中。之后，测试将重用该状态并以已认证的状态启动。

🌐 We recommend to create `playwright/.auth` directory and add it to your `.gitignore`. Your authentication routine will produce authenticated browser state and save it to a file in this `playwright/.auth` directory. Later on, tests will reuse this state and start already authenticated.

danger

浏览器状态文件可能包含敏感的 Cookie 和头信息，这些信息可能被用来冒充你或你的测试账户。我们强烈不建议将它们提交到私有或公共仓库。

🌐 The browser state file may contain sensitive cookies and headers that could be used to impersonate you or your test account. We strongly discourage checking them into private or public repositories.

*   Bash
*   PowerShell
*   Batch

```
mkdir -p playwright/.authecho $'\nplaywright/.auth' >> .gitignore
```

🌐 Basic: shared account in all tests

这是针对**没有服务器端状态**的测试的**推荐**方法。在**设置项目**中进行一次身份验证，保存身份验证状态，然后在启动每个测试时重用该状态，从而保持已认证状态。

🌐 This is the **recommended** approach for tests **without server-side state**. Authenticate once in the **setup project**, save the authentication state, and then reuse it to bootstrap each test already authenticated.

**何时使用**

*   当你可以想象所有测试都使用同一个账户同时运行，而不互相影响时。

**何时不使用**

*   你的测试会修改服务器端状态。例如，一个测试检查设置页面的渲染，而另一个测试则更改设置，并且你是并行运行测试的。在这种情况下，测试必须使用不同的账户。
*   你的身份验证是特定于浏览器的。

**详情**

创建 `tests/auth.setup.ts` 来为所有其他测试准备经过认证的浏览器状态。

🌐 Create `tests/auth.setup.ts` that will prepare authenticated browser state for all other tests.

tests/auth.setup.ts

```ts
import { test as setup, expect } from '@playwright/test';
import path from 'path';
const authFile = path.join(__dirname, '../playwright/.auth/user.json');
setup('authenticate', async ({ page }) => {
  // Perform authentication steps. Replace these actions with your own.  await page.goto('https://github.com/login');  await page.getByLabel('Username or email address').fill('username');  await page.getByLabel('Password').fill('password');  await page.getByRole('button', { name: 'Sign in' }).click();  // Wait until the page receives the cookies.  //  // Sometimes login flow sets cookies in the process of several redirects.  // Wait for the final URL to ensure that the cookies are actually set.  await page.waitForURL('https://github.com/');  // Alternatively, you can wait until the page reaches a state where all cookies are set.  await expect(page.getByRole('button', { name: 'View profile and more' })).toBeVisible();  // End of authentication steps.  await page.context().storageState({ path: authFile });
});
```

在配置中创建一个新的 `setup` 项目，并将其声明为所有测试项目的[依赖](https://playwright.nodejs.cn/docs/test-projects#dependencies)。该项目将在所有测试之前始终运行并进行身份验证。所有测试项目都应使用经过身份验证的状态作为 `storageState`。

🌐 Create a new `setup` project in the config and declare it as a [dependency](https://playwright.nodejs.cn/docs/test-projects#dependencies) for all your testing projects. This project will always run and authenticate before all the tests. All testing projects should use the authenticated state as `storageState`.

playwright.config.ts

```json
import { defineConfig, devices } from '@playwright/test';export default defineConfig({  projects: [    // Setup project    { name: 'setup', testMatch: /.*\.setup\.ts/ },    {      name: 'chromium',      use: {        ...devices['Desktop Chrome'],        // Use prepared auth state.        storageState: 'playwright/.auth/user.json',      },      dependencies: ['setup'],    },    {      name: 'firefox',      use: {        ...devices['Desktop Firefox'],        // Use prepared auth state.        storageState: 'playwright/.auth/user.json',      },      dependencies: ['setup'],    },  ],});
```

测试因为我们在配置中指定了 `storageState`，所以已经是经过身份验证的状态开始。

🌐 Tests start already authenticated because we specified `storageState` in the config.

tests/example.spec.ts

```ts
import { test } from '@playwright/test';
test('test', async ({ page }) => {
  // page is authenticated});
```

请注意，当存储的状态过期时需要将其删除。如果在测试运行之间不需要保留状态，请将浏览器状态写入 [testProject.outputDir](https://playwright.nodejs.cn/docs/api/class-testproject#test-project-output-dir)，该目录会在每次测试运行前自动清理。

🌐 Note that you need to delete the stored state when it expires. If you don't need to keep the state between test runs, write the browser state under [testProject.outputDir](https://playwright.nodejs.cn/docs/api/class-testproject#test-project-output-dir), which is automatically cleaned up before every test run.

### UI 模式下的认证

🌐 Authenticating in UI mode

为了提高测试速度，UI 模式默认不会运行 `setup` 项目。我们建议在现有认证过期时，偶尔手动运行 `auth.setup.ts` 进行认证。

🌐 UI mode will not run the `setup` project by default to improve testing speed. We recommend to authenticate by manually running the `auth.setup.ts` from time to time, whenever existing authentication expires.

首先[在筛选器中启用 `setup` 项目](https://playwright.nodejs.cn/docs/test-ui-mode#filtering-tests)，然后点击 `auth.setup.ts` 文件旁边的三角按钮，接着再次在筛选器中禁用 `setup` 项目。

🌐 First [enable the `setup` project in the filters](https://playwright.nodejs.cn/docs/test-ui-mode#filtering-tests), then click the triangle button next to `auth.setup.ts` file, and then disable the `setup` project in the filters again.

## 适中：每个并行工作者一个账户

🌐 Moderate: one account per parallel worker

这是针对**修改服务器端状态**的测试的**推荐**方法。在 Playwright 中，工作进程是并行运行的。在这种方法中，每个并行工作进程只进行一次身份验证。该工作进程运行的所有测试都重复使用相同的身份验证状态。我们将需要多个测试账户，每个并行工作进程一个。

🌐 This is the **recommended** approach for tests that **modify server-side state**. In Playwright, worker processes run in parallel. In this approach, each parallel worker is authenticated once. All tests ran by worker are reusing the same authentication state. We will need multiple testing accounts, one per each parallel worker.

**何时使用**

*   你的测试会修改共享的服务器端状态。例如，一个测试检查设置页面的渲染，而另一个测试正在更改设置。

**何时不使用**

*   你的测试不会修改任何共享的服务器端状态。在这种情况下，所有测试都可以使用一个共享账户。

**详情**

我们将对每个[工作进程](https://playwright.nodejs.cn/docs/test-parallel#worker-processes)进行一次身份验证，每个进程使用一个唯一的账户。

🌐 We will authenticate once per [worker process](https://playwright.nodejs.cn/docs/test-parallel#worker-processes), each with a unique account.

创建 `playwright/fixtures.ts` 文件，该文件将 [覆盖 `storageState` 夹具](https://playwright.nodejs.cn/docs/test-fixtures#overriding-fixtures) 以便每个工作进程仅进行一次身份验证。使用 [testInfo.parallelIndex](https://playwright.nodejs.cn/docs/api/class-testinfo#test-info-parallel-index) 来区分不同的工作进程。

🌐 Create `playwright/fixtures.ts` file that will [override `storageState` fixture](https://playwright.nodejs.cn/docs/test-fixtures#overriding-fixtures) to authenticate once per worker. Use [testInfo.parallelIndex](https://playwright.nodejs.cn/docs/api/class-testinfo#test-info-parallel-index) to differentiate between workers.

playwright/fixtures.ts

```json
import { test as baseTest, expect } from '@playwright/test';import fs from 'fs';import path from 'path';export * from '@playwright/test';export const test = baseTest.extend<{}, { workerStorageState: string }>({  // Use the same storage state for all tests in this worker.  storageState: ({ workerStorageState }, use) => use(workerStorageState),  // Authenticate once per worker with a worker-scoped fixture.  workerStorageState: [async ({ browser }, use) => {    // Use parallelIndex as a unique identifier for each worker.    const id = test.info().parallelIndex;    const fileName = path.resolve(test.info().project.outputDir, `.auth/${id}.json`);    if (fs.existsSync(fileName)) {      // Reuse existing authentication state if any.      await use(fileName);      return;    }    // Important: make sure we authenticate in a clean environment by unsetting storage state.    const page = await browser.newPage({ storageState: undefined });    // Acquire a unique account, for example create a new one.    // Alternatively, you can have a list of precreated accounts for testing.    // Make sure that accounts are unique, so that multiple team members    // can run tests at the same time without interference.    const account = await acquireAccount(id);    // Perform authentication steps. Replace these actions with your own.    await page.goto('https://github.com/login');    await page.getByLabel('Username or email address').fill(account.username);    await page.getByLabel('Password').fill(account.password);    await page.getByRole('button', { name: 'Sign in' }).click();    // Wait until the page receives the cookies.    //    // Sometimes login flow sets cookies in the process of several redirects.    // Wait for the final URL to ensure that the cookies are actually set.    await page.waitForURL('https://github.com/');    // Alternatively, you can wait until the page reaches a state where all cookies are set.    await expect(page.getByRole('button', { name: 'View profile and more' })).toBeVisible();    // End of authentication steps.    await page.context().storageState({ path: fileName });    await page.close();    await use(fileName);  }, { scope: 'worker' }],});
```

现在，每个测试文件都应该从我们的 fixtures 文件中导入 `test` 而不是 `@playwright/test`。配置文件无需更改。

🌐 Now, each test file should import `test` from our fixtures file instead of `@playwright/test`. No changes are needed in the config.

tests/example.spec.ts

```ts
// Important: import our fixtures.import { test, expect } from '../playwright/fixtures';
test('test', async ({ page }) => {
  // page is authenticated});
```

## 高级场景

🌐 Advanced scenarios

### 使用 API 请求进行身份验证

🌐 Authenticate with API request

**何时使用**

*   你的 Web 应用支持通过 API 进行身份验证，这比与应用 UI 交互更容易/更快。

**详情**

我们将使用 [APIRequestContext](https://playwright.nodejs.cn/docs/api/class-apirequestcontext "APIRequestContext") 发送 API 请求，然后像往常一样保存已认证的状态。

🌐 We will send the API request with [APIRequestContext](https://playwright.nodejs.cn/docs/api/class-apirequestcontext "APIRequestContext") and then save authenticated state as usual.

在 [设置项目](http://playwright.nodejs.cn/docs/auth#basic-shared-account-in-all-tests) 中：

🌐 In the [setup project](http://playwright.nodejs.cn/docs/auth#basic-shared-account-in-all-tests):

tests/auth.setup.ts

```json
import { test as setup } from '@playwright/test';const authFile = 'playwright/.auth/user.json';setup('authenticate', async ({ request }) => {  // Send authentication request. Replace with your own.  await request.post('https://github.com/login', {    form: {      'user': 'user',      'password': 'password'    }  });  await request.storageState({ path: authFile });});
```

或者，在一个 [worker fixture](http://playwright.nodejs.cn/docs/auth#moderate-one-account-per-parallel-worker) 中：

🌐 Alternatively, in a [worker fixture](http://playwright.nodejs.cn/docs/auth#moderate-one-account-per-parallel-worker):

playwright/fixtures.ts

```json
import { test as baseTest, request } from '@playwright/test';import fs from 'fs';import path from 'path';export * from '@playwright/test';export const test = baseTest.extend<{}, { workerStorageState: string }>({  // Use the same storage state for all tests in this worker.  storageState: ({ workerStorageState }, use) => use(workerStorageState),  // Authenticate once per worker with a worker-scoped fixture.  workerStorageState: [async ({}, use) => {    // Use parallelIndex as a unique identifier for each worker.    const id = test.info().parallelIndex;    const fileName = path.resolve(test.info().project.outputDir, `.auth/${id}.json`);    if (fs.existsSync(fileName)) {      // Reuse existing authentication state if any.      await use(fileName);      return;    }    // Important: make sure we authenticate in a clean environment by unsetting storage state.    const context = await request.newContext({ storageState: undefined });    // Acquire a unique account, for example create a new one.    // Alternatively, you can have a list of precreated accounts for testing.    // Make sure that accounts are unique, so that multiple team members    // can run tests at the same time without interference.    const account = await acquireAccount(id);    // Send authentication request. Replace with your own.    await context.post('https://github.com/login', {      form: {        'user': 'user',        'password': 'password'      }    });    await context.storageState({ path: fileName });    await context.dispose();    await use(fileName);  }, { scope: 'worker' }],});
```

### 多个登录角色

🌐 Multiple signed in roles

**何时使用**

*   你在端到端测试中拥有多个角色，但你可以在所有测试中重复使用账户。

**详情**

我们将在安装项目中进行多次验证。

🌐 We will authenticate multiple times in the setup project.

tests/auth.setup.ts

```ts
import { test as setup, expect } from '@playwright/test';
const adminFile = 'playwright/.auth/admin.json';
setup('authenticate as admin', async ({ page }) => {
  // Perform authentication steps. Replace these actions with your own.  await page.goto('https://github.com/login');  await page.getByLabel('Username or email address').fill('admin');  await page.getByLabel('Password').fill('password');  await page.getByRole('button', { name: 'Sign in' }).click();  // Wait until the page receives the cookies.  //  // Sometimes login flow sets cookies in the process of several redirects.  // Wait for the final URL to ensure that the cookies are actually set.  await page.waitForURL('https://github.com/');  // Alternatively, you can wait until the page reaches a state where all cookies are set.  await expect(page.getByRole('button', { name: 'View profile and more' })).toBeVisible();  // End of authentication steps.  await page.context().storageState({ path: adminFile });
});
const userFile = 'playwright/.auth/user.json';
setup('authenticate as user', async ({ page }) => {
  // Perform authentication steps. Replace these actions with your own.  await page.goto('https://github.com/login');  await page.getByLabel('Username or email address').fill('user');  await page.getByLabel('Password').fill('password');  await page.getByRole('button', { name: 'Sign in' }).click();  // Wait until the page receives the cookies.  //  // Sometimes login flow sets cookies in the process of several redirects.  // Wait for the final URL to ensure that the cookies are actually set.  await page.waitForURL('https://github.com/');  // Alternatively, you can wait until the page reaches a state where all cookies are set.  await expect(page.getByRole('button', { name: 'View profile and more' })).toBeVisible();  // End of authentication steps.  await page.context().storageState({ path: userFile });
});
```

之后，为每个测试文件或测试组指定 `storageState`，**而不是**在配置中设置它。

🌐 After that, specify `storageState` for each test file or test group, **instead of** setting it in the config.

tests/example.spec.ts

```ts
import { test } from '@playwright/test';
test.use({ storageState: 'playwright/.auth/admin.json' });
test('admin test', async ({ page }) => {
  // page is authenticated as admin});
test.describe(() => {
  test.use({ storageState: 'playwright/.auth/user.json' });  test('user test', async ({ page }) => {
  // page is authenticated as a user  });
});
```

另请参阅关于[在 UI 模式下进行身份验证](http://playwright.nodejs.cn/docs/auth#authenticating-in-ui-mode)的内容。

🌐 See also about [authenticating in the UI mode](http://playwright.nodejs.cn/docs/auth#authenticating-in-ui-mode).

### 一起测试多个角色

🌐 Testing multiple roles together

**何时使用**

*   你需要在单个测试中测试多个经过身份验证的角色如何交互。

**详情**

在同一个测试中使用具有不同存储状态的多个 [BrowserContext](https://playwright.nodejs.cn/docs/api/class-browsercontext "BrowserContext") 和 [Page](https://playwright.nodejs.cn/docs/api/class-page "Page")。

🌐 Use multiple [BrowserContext](https://playwright.nodejs.cn/docs/api/class-browsercontext "BrowserContext")s and [Page](https://playwright.nodejs.cn/docs/api/class-page "Page")s with different storage states in the same test.

tests/example.spec.ts

```ts
import { test } from '@playwright/test';
test('admin and user', async ({ browser }) => {
  // adminContext and all pages inside, including adminPage, are signed in as "admin".  const adminContext = await browser.newContext({ storageState: 'playwright/.auth/admin.json' });  const adminPage = await adminContext.newPage();  // userContext and all pages inside, including userPage, are signed in as "user".  const userContext = await browser.newContext({ storageState: 'playwright/.auth/user.json' });  const userPage = await userContext.newPage();  // ... interact with both adminPage and userPage ...  await adminContext.close();  await userContext.close();
});
```

### 使用 POM 夹具测试多个角色

🌐 Testing multiple roles with POM fixtures

**何时使用**

*   你需要在单个测试中测试多个经过身份验证的角色如何交互。

**详情**

你可以引入夹具，以提供经过每个角色身份验证的页面。

🌐 You can introduce fixtures that will provide a page authenticated as each role.

下面是一个示例，它为两个页面对象模型（Page Object Models）——管理员 POM 和用户 POM——[创建夹具](https://playwright.nodejs.cn/docs/test-fixtures#creating-a-fixture)。假设 `adminStorageState.json` 和 `userStorageState.json` 文件已在全局设置中创建。

🌐 Below is an example that [creates fixtures](https://playwright.nodejs.cn/docs/test-fixtures#creating-a-fixture) for two [Page Object Models](https://playwright.nodejs.cn/docs/pom) - admin POM and user POM. It assumes `adminStorageState.json` and `userStorageState.json` files were created in the global setup.

playwright/fixtures.ts

```ts
import { test as base, type Page, type Locator } from '@playwright/test';
// Page Object Model for the "admin" page.// Here you can add locators and helper methods specific to the admin page.class AdminPage {
  // Page signed in as "admin".  page: Page;  // Example locator pointing to "Welcome, Admin" greeting.  greeting: Locator;  constructor(page: Page) {
  this.page = page;    this.greeting = page.locator('#greeting');  }}// Page Object Model for the "user" page.// Here you can add locators and helper methods specific to the user page.class UserPage {
  // Page signed in as "user".  page: Page;  // Example locator pointing to "Welcome, User" greeting.  greeting: Locator;  constructor(page: Page) {
  this.page = page;    this.greeting = page.locator('#greeting');  }}// Declare the types of your fixtures.type MyFixtures = {
  adminPage: AdminPage;  userPage: UserPage;
};
export * from '@playwright/test';
export const test = base.extend<MyFixtures>({
  adminPage: async ({ browser }, use) => {
  const context = await browser.newContext({ storageState: 'playwright/.auth/admin.json' });    const adminPage = new AdminPage(await context.newPage());    await use(adminPage);    await context.close();  },  userPage: async ({ browser }, use) => {
  const context = await browser.newContext({ storageState: 'playwright/.auth/user.json' });    const userPage = new UserPage(await context.newPage());    await use(userPage);    await context.close();  },});
```

tests/example.spec.ts

```ts
// Import test with our new fixtures.import { test, expect } from '../playwright/fixtures';
// Use adminPage and userPage fixtures in the test.test('admin and user', async ({ adminPage, userPage }) => {
  // ... interact with both adminPage and userPage ...  await expect(adminPage.greeting).toHaveText('Welcome, Admin');  await expect(userPage.greeting).toHaveText('Welcome, User');
});
```

### 会话存储

🌐 Session storage

重用已验证的状态包括基于[Cookie](https://web.nodejs.cn/en-US/docs/Web/HTTP/Cookies)、[本地存储](https://web.nodejs.cn/en-US/docs/Web/API/Storage)和[IndexedDB](https://web.nodejs.cn/en-US/docs/Web/API/IndexedDB_API)的认证。很少情况下，[会话存储](https://web.nodejs.cn/en-US/docs/Web/API/Window/sessionStorage)用于存储与登录状态相关的信息。会话存储特定于某个域，并不会在页面加载之间保持。Playwright 不提供持久化会话存储的 API，但可以使用以下代码片段来保存/加载会话存储。

🌐 Reusing authenticated state covers [cookies](https://web.nodejs.cn/en-US/docs/Web/HTTP/Cookies), [local storage](https://web.nodejs.cn/en-US/docs/Web/API/Storage) and [IndexedDB](https://web.nodejs.cn/en-US/docs/Web/API/IndexedDB_API) based authentication. Rarely, [session storage](https://web.nodejs.cn/en-US/docs/Web/API/Window/sessionStorage) is used for storing information associated with the signed-in state. Session storage is specific to a particular domain and is not persisted across page loads. Playwright does not provide API to persist session storage, but the following snippet can be used to save/load session storage.

```ts
// Get session storage and store as env variableconst sessionStorage = await page.evaluate(() => JSON.stringify(sessionStorage));
fs.writeFileSync('playwright/.auth/session.json', sessionStorage, 'utf-8');
// Set session storage in a new contextconst sessionStorage = JSON.parse(fs.readFileSync('playwright/.auth/session.json', 'utf-8'));
await context.addInitScript(storage => {
  if (window.location.hostname === 'example.com') {
  for (const [key, value] of Object.entries(storage))      window.sessionStorage.setItem(key, value);  }}, sessionStorage);
```

### 在某些测试中避免身份验证

🌐 Avoid authentication in some tests

你可以重置测试文件中的存储状态，以避免为整个项目设置的身份验证。

🌐 You can reset storage state in a test file to avoid authentication that was set up for the whole project.

not-signed-in.spec.ts

```json
import { test } from '@playwright/test';// Reset storage state for this file to avoid being authenticatedtest.use({ storageState: { cookies: [], origins: [] } });test('not signed in test', async ({ page }) => {  // ...});
```
