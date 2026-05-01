---
title: 断言
source_url: https://playwright.nodejs.cn/docs/test-assertions
fetched_at: 2026-04-29T02:57:28.664Z
---

# 断言

## 介绍

🌐 Introduction

Playwright 包含以 `expect` 函数形式的测试断言。要进行断言，请调用 `expect(value)` 并选择一个反映期望的匹配器。有许多 [通用匹配器](https://playwright.nodejs.cn/docs/api/class-genericassertions)，比如 `toEqual`、`toContain`、`toBeTruthy`，可以用来断言任何条件。

🌐 Playwright includes test assertions in the form of `expect` function. To make an assertion, call `expect(value)` and choose a matcher that reflects the expectation. There are many [generic matchers](https://playwright.nodejs.cn/docs/api/class-genericassertions) like `toEqual`, `toContain`, `toBeTruthy` that can be used to assert any conditions.

```ts
expect(success).toBeTruthy();
```

Playwright 还包括专门针对网页的[异步匹配器](https://playwright.nodejs.cn/docs/api/class-locatorassertions)，它会等待直到满足预期条件。请看以下示例：

🌐 Playwright also includes web-specific [async matchers](https://playwright.nodejs.cn/docs/api/class-locatorassertions) that will wait until the expected condition is met. Consider the following example:

```ts
await expect(page.getByTestId('status')).toHaveText('Submitted');
```

Playwright 将会重新测试测试 ID 为 `status` 的元素，直到获取的元素包含 `"Submitted"` 文本。它会反复重新获取元素并进行检查，直到满足条件或达到超时为止。你可以直接传入这个超时值，或者通过测试配置中的 [testConfig.expect](https://playwright.nodejs.cn/docs/api/class-testconfig#test-config-expect) 值配置一次。

🌐 Playwright will be re-testing the element with the test id of `status` until the fetched element has the `"Submitted"` text. It will re-fetch the element and check it over and over, until the condition is met or until the timeout is reached. You can either pass this timeout or configure it once via the [testConfig.expect](https://playwright.nodejs.cn/docs/api/class-testconfig#test-config-expect) value in the test config.

默认情况下，断言的超时时间设置为5秒。了解更多关于[各种超时](https://playwright.nodejs.cn/docs/test-timeouts)的信息。

🌐 By default, the timeout for assertions is set to 5 seconds. Learn more about [various timeouts](https://playwright.nodejs.cn/docs/test-timeouts).

## 自动重试断言

🌐 Auto-retrying assertions

以下断言将会重复尝试，直到断言通过或达到断言超时。请注意，重试断言是异步的，所以你必须 `await` 它们。

🌐 The following assertions will retry until the assertion passes, or the assertion timeout is reached. Note that retrying assertions are async, so you must `await` them.

| 断言 | 描述 |

| :- | :- |

| [await expect(locator).toBeAttached()](https://playwright.nodejs.cn/docs/api/class-locatorassertions#locator-assertions-to-be-attached) | 元素已附加 |

| [await expect(locator).toBeChecked()](https://playwright.nodejs.cn/docs/api/class-locatorassertions#locator-assertions-to-be-checked) | 复选框已选中 |

| [await expect(locator).toBeDisabled()](https://playwright.nodejs.cn/docs/api/class-locatorassertions#locator-assertions-to-be-disabled) | 元素已被禁用 |

| [await expect(locator).toBeEditable()](https://playwright.nodejs.cn/docs/api/class-locatorassertions#locator-assertions-to-be-editable) | 元素可编辑 |

| [await expect(locator).toBeEmpty()](https://playwright.nodejs.cn/docs/api/class-locatorassertions#locator-assertions-to-be-empty) | 容器为空 |

| [await expect(locator).toBeEnabled()](https://playwright.nodejs.cn/docs/api/class-locatorassertions#locator-assertions-to-be-enabled) | 元素已启用 |

| [await expect(locator).toBeFocused()](https://playwright.nodejs.cn/docs/api/class-locatorassertions#locator-assertions-to-be-focused) | 元素已获得焦点 |

| [await expect(locator).toBeHidden()](https://playwright.nodejs.cn/docs/api/class-locatorassertions#locator-assertions-to-be-hidden) | 元素不可见 |

| [await expect(locator).toBeInViewport()](https://playwright.nodejs.cn/docs/api/class-locatorassertions#locator-assertions-to-be-in-viewport) | 元素与视口相交 |

| [await expect(locator).toBeVisible()](https://playwright.nodejs.cn/docs/api/class-locatorassertions#locator-assertions-to-be-visible) | 元素可见 |

| [await expect(locator).toContainText()](https://playwright.nodejs.cn/docs/api/class-locatorassertions#locator-assertions-to-contain-text) | 元素包含文本 |

| [await expect(locator).toContainClass()](https://playwright.nodejs.cn/docs/api/class-locatorassertions#locator-assertions-to-contain-class) | 元素具有指定的 CSS 类 |

| [await expect(locator).toHaveAccessibleDescription()](https://playwright.nodejs.cn/docs/api/class-locatorassertions#locator-assertions-to-have-accessible-description) | 元素具有匹配的[可访问描述](https://w3c.github.io/accname/#dfn-accessible-description) |

| [await expect(locator).toHaveAccessibleName()](https://playwright.nodejs.cn/docs/api/class-locatorassertions#locator-assertions-to-have-accessible-name) | 元素具有匹配的[可访问名称](https://w3c.github.io/accname/#dfn-accessible-name) |

| [await expect(locator).toHaveAttribute()](https://playwright.nodejs.cn/docs/api/class-locatorassertions#locator-assertions-to-have-attribute) | 元素具有 DOM 属性 |

| [await expect(locator).toHaveClass()](https://playwright.nodejs.cn/docs/api/class-locatorassertions#locator-assertions-to-have-class) | 元素具有指定的 CSS 类属性 |

| [await expect(locator).toHaveCount()](https://playwright.nodejs.cn/docs/api/class-locatorassertions#locator-assertions-to-have-count) | 列表具有准确数量的子元素 |

| [await expect(locator).toHaveCSS()](https://playwright.nodejs.cn/docs/api/class-locatorassertions#locator-assertions-to-have-css) | 元素具有 CSS 属性 |

| [await expect(locator).toHaveId()](https://playwright.nodejs.cn/docs/api/class-locatorassertions#locator-assertions-to-have-id) | 元素有一个 ID |

| [await expect(locator).toHaveJSProperty()](https://playwright.nodejs.cn/docs/api/class-locatorassertions#locator-assertions-to-have-js-property) | 元素具有 JavaScript 属性 |

| [await expect(locator).toHaveRole()](https://playwright.nodejs.cn/docs/api/class-locatorassertions#locator-assertions-to-have-role) | 元素具有特定的 [ARIA 角色](https://www.w3.org/TR/wai-aria-1.2/#roles) |

| [await expect(locator).toHaveScreenshot()](https://playwright.nodejs.cn/docs/api/class-locatorassertions#locator-assertions-to-have-screenshot-1) | 元素有截图 |

| [await expect(locator).toHaveText()](https://playwright.nodejs.cn/docs/api/class-locatorassertions#locator-assertions-to-have-text) | 元素匹配文本 |

| [await expect(locator).toHaveValue()](https://playwright.nodejs.cn/docs/api/class-locatorassertions#locator-assertions-to-have-value) | 输入框有一个值 |

| [await expect(locator).toHaveValues()](https://playwright.nodejs.cn/docs/api/class-locatorassertions#locator-assertions-to-have-values) | 选择框已选择选项 |

| [await expect(locator).toMatchAriaSnapshot()](https://playwright.nodejs.cn/docs/api/class-locatorassertions#locator-assertions-to-match-aria-snapshot) | 元素匹配 Aria 快照 |

| [await expect(page).toHaveScreenshot()](https://playwright.nodejs.cn/docs/api/class-pageassertions#page-assertions-to-have-screenshot-1) | 页面有截图 |

| [await expect(page).toHaveTitle()](https://playwright.nodejs.cn/docs/api/class-pageassertions#page-assertions-to-have-title) | 页面有标题 |

| [await expect(page).toHaveURL()](https://playwright.nodejs.cn/docs/api/class-pageassertions#page-assertions-to-have-url) | 页面有一个 URL |

| [await expect(response).toBeOK()](https://playwright.nodejs.cn/docs/api/class-apiresponseassertions#api-response-assertions-to-be-ok) | 响应状态为 OK |

## 不重试断言

🌐 Non-retrying assertions

这些断言允许测试任何条件，但不会自动重试。大多数情况下，网页会异步显示信息，使用不重试的断言可能导致测试不稳定。

🌐 These assertions allow to test any conditions, but do not auto-retry. Most of the time, web pages show information asynchronously, and using non-retrying assertions can lead to a flaky test.

尽可能优先使用 [自动重试](http://playwright.nodejs.cn/docs/test-assertions#auto-retrying-assertions) 断言。对于需要重试的更复杂断言，请使用 [`expect.poll`](http://playwright.nodejs.cn/docs/test-assertions#expectpoll) 或 [`expect.toPass`](http://playwright.nodejs.cn/docs/test-assertions#expecttopass)。

🌐 Prefer [auto-retrying](http://playwright.nodejs.cn/docs/test-assertions#auto-retrying-assertions) assertions whenever possible. For more complex assertions that need to be retried, use [`expect.poll`](http://playwright.nodejs.cn/docs/test-assertions#expectpoll) or [`expect.toPass`](http://playwright.nodejs.cn/docs/test-assertions#expecttopass).

| 断言 | 描述 |

| :- | :- |

| [expect(value).toBe()](https://playwright.nodejs.cn/docs/api/class-genericassertions#generic-assertions-to-be) | 值是相同的 |

| [expect(value).toBeCloseTo()](https://playwright.nodejs.cn/docs/api/class-genericassertions#generic-assertions-to-be-close-to) | 数值大致相等 |

| [expect(value).toBeDefined()](https://playwright.nodejs.cn/docs/api/class-genericassertions#generic-assertions-to-be-defined) | 值不是 `undefined` |

| [expect(value).toBeFalsy()](https://playwright.nodejs.cn/docs/api/class-genericassertions#generic-assertions-to-be-falsy) | 值为假值，例如 `false`、`0`、`null` 等。 |

| [expect(value).toBeGreaterThan()](https://playwright.nodejs.cn/docs/api/class-genericassertions#generic-assertions-to-be-greater-than) | 数字大于 |

| [expect(value).toBeGreaterThanOrEqual()](https://playwright.nodejs.cn/docs/api/class-genericassertions#generic-assertions-to-be-greater-than-or-equal) | 数字大于或等于 |

| [expect(value).toBeInstanceOf()](https://playwright.nodejs.cn/docs/api/class-genericassertions#generic-assertions-to-be-instance-of) | 对象是某个类的实例 |

| [expect(value).toBeLessThan()](https://playwright.nodejs.cn/docs/api/class-genericassertions#generic-assertions-to-be-less-than) | 数字小于 |

| [expect(value).toBeLessThanOrEqual()](https://playwright.nodejs.cn/docs/api/class-genericassertions#generic-assertions-to-be-less-than-or-equal) | 数字小于或等于 |

| [expect(value).toBeNaN()](https://playwright.nodejs.cn/docs/api/class-genericassertions#generic-assertions-to-be-na-n) | 值是 `NaN` |

| [expect(value).toBeNull()](https://playwright.nodejs.cn/docs/api/class-genericassertions#generic-assertions-to-be-null) | 值是 `null` |

| [expect(value).toBeTruthy()](https://playwright.nodejs.cn/docs/api/class-genericassertions#generic-assertions-to-be-truthy) | 值为真，即不是 `false`、`0`、`null` 等。 |

| [expect(value).toBeUndefined()](https://playwright.nodejs.cn/docs/api/class-genericassertions#generic-assertions-to-be-undefined) | 值是 `undefined` |

| [expect(value).toContain()](https://playwright.nodejs.cn/docs/api/class-genericassertions#generic-assertions-to-contain-1) | 字符串包含子字符串 |

| [expect(value).toContain()](https://playwright.nodejs.cn/docs/api/class-genericassertions#generic-assertions-to-contain-2) | 数组或集合包含一个元素 |

| [expect(value).toContainEqual()](https://playwright.nodejs.cn/docs/api/class-genericassertions#generic-assertions-to-contain-equal) | 数组或集合包含一个相似的元素 |

| [expect(value).toEqual()](https://playwright.nodejs.cn/docs/api/class-genericassertions#generic-assertions-to-equal) | 值相似 - 深度相等和模式匹配 |

| [expect(value).toHaveLength()](https://playwright.nodejs.cn/docs/api/class-genericassertions#generic-assertions-to-have-length) | 数组或字符串具有长度 |

| [expect(value).toHaveProperty()](https://playwright.nodejs.cn/docs/api/class-genericassertions#generic-assertions-to-have-property) | 对象具有某个属性 |

| [expect(value).toMatch()](https://playwright.nodejs.cn/docs/api/class-genericassertions#generic-assertions-to-match) | 字符串匹配正则表达式 |

| [expect(value).toMatchObject()](https://playwright.nodejs.cn/docs/api/class-genericassertions#generic-assertions-to-match-object) | 对象包含指定的属性 |

| [expect(value).toStrictEqual()](https://playwright.nodejs.cn/docs/api/class-genericassertions#generic-assertions-to-strict-equal) | 值相似，包括属性类型 |

| [expect(value).toThrow()](https://playwright.nodejs.cn/docs/api/class-genericassertions#generic-assertions-to-throw) | 函数抛出一个错误 |

## 不对称匹配器

🌐 Asymmetric matchers

这些表达式可以嵌套在其他断言中，以便对给定条件进行更宽松的匹配。

🌐 These expressions can be nested in other assertions to allow more relaxed matching against a given condition.

| 匹配器 | 描述 |

| :- | :- |

| [expect.any()](https://playwright.nodejs.cn/docs/api/class-genericassertions#generic-assertions-any) | 匹配类/原始类型的任何实例 |

| [expect.anything()](https://playwright.nodejs.cn/docs/api/class-genericassertions#generic-assertions-anything) | 匹配任何内容 |

| [expect.arrayContaining()](https://playwright.nodejs.cn/docs/api/class-genericassertions#generic-assertions-array-containing) | 数组包含特定元素 |

| [expect.arrayOf()](https://playwright.nodejs.cn/docs/api/class-genericassertions#generic-assertions-array-of) | 数组包含特定类型的元素 |

| [expect.closeTo()](https://playwright.nodejs.cn/docs/api/class-genericassertions#generic-assertions-close-to) | 数字大致相等 |

| [expect.objectContaining()](https://playwright.nodejs.cn/docs/api/class-genericassertions#generic-assertions-object-containing) | 对象包含特定属性 |

| [expect.stringContaining()](https://playwright.nodejs.cn/docs/api/class-genericassertions#generic-assertions-string-containing) | 字符串包含子字符串 |

| [expect.stringMatching()](https://playwright.nodejs.cn/docs/api/class-genericassertions#generic-assertions-string-matching) | 字符串匹配正则表达式 |

## 否定匹配器

🌐 Negating matchers

总体来说，我们可以通过在匹配器前添加 `.not` 来得到相反的结果：

🌐 In general, we can expect the opposite to be true by adding a `.not` to the front of the matchers:

```ts
expect(value).not.toEqual(0);
await expect(locator).not.toContainText('some text');
```

## 软断言

🌐 Soft assertions

默认情况下，断言失败会终止测试执行。Playwright 还支持 _软断言_：软断言失败**不会**终止测试执行，但会将测试标记为失败。

🌐 By default, failed assertion will terminate test execution. Playwright also supports _soft assertions_: failed soft assertions **do not** terminate test execution, but mark the test as failed.

```ts
// Make a few checks that will not stop the test when failed...await expect.soft(page.getByTestId('status')).toHaveText('Success');
await expect.soft(page.getByTestId('eta')).toHaveText('1 day');
// ... and continue the test to check more things.await page.getByRole('link', { name: 'next page' }).click();
await expect.soft(page.getByRole('heading', { name: 'Make another order' })).toBeVisible();
```

在测试执行期间的任何时候，你都可以检查是否存在任何软断言失败：

🌐 At any point during test execution, you can check whether there were any soft assertion failures:

```ts
// Make a few checks that will not stop the test when failed...await expect.soft(page.getByTestId('status')).toHaveText('Success');
await expect.soft(page.getByTestId('eta')).toHaveText('1 day');
// Avoid running further if there were soft assertion failures.expect(test.info().errors).toHaveLength(0);
```

请注意，软断言仅适用于 Playwright 测试运行程序。

🌐 Note that soft assertions only work with Playwright test runner.

## 自定义期望消息

🌐 Custom expect message

你可以将自定义的期望消息作为第二个参数传递给 `expect` 函数，例如：

🌐 You can specify a custom expect message as a second argument to the `expect` function, for example:

```ts
await expect(page.getByText('Name'), 'should be logged in').toBeVisible();
```

此消息将显示在报告器中，无论是通过预期还是失败预期，从而提供有关该断言的更多背景信息。

🌐 This message will be shown in reporters, both for passing and failing expects, providing more context about the assertion.

当 Expect 通过时，你可能会看到如下所示的成功步骤：

🌐 When expect passes, you might see a successful step like this:

```
✅ should be logged in    @example.spec.ts:18
```

当 Expect 失败时，错误将如下所示：

🌐 When expect fails, the error would look like this:

```ts
Error: should be logged in    Call log:      - expect.toBeVisible with timeout 5000ms      - waiting for "getByText('Name')"      2 |      3 | test('example test', async({ page }) => {
  > 4 |   await expect(page.getByText('Name'), 'should be logged in').toBeVisible();        |                                                                  ^      5 | });      6 |
```

软断言还支持自定义消息：

🌐 Soft assertions also support custom message:

```
expect.soft(value, 'my soft assertion').toBe(56);
```

## expect.configure

你可以创建自己的预配置 `expect` 实例，以拥有其自己的默认设置，例如 `timeout` 和 `soft`。

🌐 You can create your own pre-configured `expect` instance to have its own defaults such as `timeout` and `soft`.

```ts
const slowExpect = expect.configure({ timeout: 10000 });
await slowExpect(locator).toHaveText('Submit');
// Always do soft assertions.const softExpect = expect.configure({ soft: true });
await softExpect(locator).toHaveText('Submit');
```

## expect.poll

你可以使用 `expect.poll` 将任何同步的 `expect` 转换为异步轮询版本。

🌐 You can convert any synchronous `expect` to an asynchronous polling one using `expect.poll`.

以下方法将轮询给定函数，直到返回 HTTP 状态 200：

🌐 The following method will poll given function until it returns HTTP status 200:

```ts
await expect.poll(async () => {
  const response = await page.request.get('https://api.example.com');  return response.status();
}, {
  // Custom expect message for reporting, optional.  message: 'make sure API eventually succeeds',  // Poll for 10 seconds; defaults to 5 seconds. Pass 0 to disable timeout.  timeout: 10000,}).toBe(200);
```

你还可以指定自定义轮询间隔：

🌐 You can also specify custom polling intervals:

```json
await expect.poll(async () => {  const response = await page.request.get('https://api.example.com');  return response.status();}, {  // Probe, wait 1s, probe, wait 2s, probe, wait 10s, probe, wait 10s, probe  // ... Defaults to [100, 250, 500, 1000].  intervals: [1_000, 2_000, 10_000],  timeout: 60_000}).toBe(200);
```

你可以将 `expect.configure({ soft: true })` 与 expect.poll 结合使用，在轮询逻辑中执行软断言。

🌐 You can combine `expect.configure({ soft: true })` with expect.poll to perform soft assertions in polling logic.

```ts
const softExpect = expect.configure({ soft: true });
await softExpect.poll(async () => {
  const response = await page.request.get('https://api.example.com');  return response.status();
}, {}).toBe(200);
```

即使轮询中的断言失败，这也允许测试继续进行。

🌐 This allows the test to continue even if the assertion inside poll fails.

## expect.toPass

你可以重试代码块，直到它们成功通过。

🌐 You can retry blocks of code until they are passing successfully.

```ts
await expect(async () => {
  const response = await page.request.get('https://api.example.com');  expect(response.status()).toBe(200);
}).toPass();
```

你还可以指定自定义超时和重试间隔：

🌐 You can also specify custom timeout and retry intervals:

```json
await expect(async () => {  const response = await page.request.get('https://api.example.com');  expect(response.status()).toBe(200);}).toPass({  // Probe, wait 1s, probe, wait 2s, probe, wait 10s, probe, wait 10s, probe  // ... Defaults to [100, 250, 500, 1000].  intervals: [1_000, 2_000, 10_000],  timeout: 60_000});
```

请注意，默认情况下 `toPass` 的超时为 0，并且不遵循自定义的 [期望超时](https://playwright.nodejs.cn/docs/test-timeouts#expect-timeout)。

🌐 Note that by default `toPass` has timeout 0 and does not respect custom [expect timeout](https://playwright.nodejs.cn/docs/test-timeouts#expect-timeout).

## 使用 expect.extend 添加自定义匹配器

🌐 Add custom matchers using expect.extend

你可以通过提供自定义匹配器来扩展 Playwright 的断言。这些匹配器将在 `expect` 对象上可用。

🌐 You can extend Playwright assertions by providing custom matchers. These matchers will be available on the `expect` object.

在这个例子中，我们添加了一个自定义的 `toHaveAmount` 函数。自定义匹配器应返回一个 `pass` 标志，指示断言是否通过，以及一个 `message` 回调，用于断言失败时使用。

🌐 In this example we add a custom `toHaveAmount` function. Custom matcher should return a `pass` flag indicating whether the assertion passed, and a `message` callback that's used when the assertion fails.

fixtures.ts

```json
import { expect as baseExpect } from '@playwright/test';import type { Locator } from '@playwright/test';export { test } from '@playwright/test';export const expect = baseExpect.extend({  async toHaveAmount(locator: Locator, expected: number, options?: { timeout?: number }) {    const assertionName = 'toHaveAmount';    let pass: boolean;    let matcherResult: any;    try {      const expectation = this.isNot ? baseExpect(locator).not : baseExpect(locator);      await expectation.toHaveAttribute('data-amount', String(expected), options);      pass = true;    } catch (e: any) {      matcherResult = e.matcherResult;      pass = false;    }    if (this.isNot) {      pass =!pass;    }    const message = pass      ? () => this.utils.matcherHint(assertionName, undefined, undefined, { isNot: this.isNot }) +          '\n\n' +          `Locator: ${locator}\n` +          `Expected: not ${this.utils.printExpected(expected)}\n` +          (matcherResult ? `Received: ${this.utils.printReceived(matcherResult.actual)}` : '')      : () =>  this.utils.matcherHint(assertionName, undefined, undefined, { isNot: this.isNot }) +          '\n\n' +          `Locator: ${locator}\n` +          `Expected: ${this.utils.printExpected(expected)}\n` +          (matcherResult ? `Received: ${this.utils.printReceived(matcherResult.actual)}` : '');    return {      message,      pass,      name: assertionName,      expected,      actual: matcherResult?.actual,    };  },});
```

现在我们可以在测试中使用 `toHaveAmount`。

🌐 Now we can use `toHaveAmount` in the test.

example.spec.ts

```ts
import { test, expect } from './fixtures';
test('amount', async () => {
  await expect(page.locator('.cart')).toHaveAmount(4);
});
```

### 与期望库的兼容性

🌐 Compatibility with expect library

note

不要将 Playwright 的 `expect` 与 [`expect` 库](https://jest.nodejs.cn/docs/expect) 混淆。后者并未与 Playwright 测试运行器完全集成，因此请确保使用 Playwright 自带的 `expect`。

🌐 Do not confuse Playwright's `expect` with the [`expect` library](https://jest.nodejs.cn/docs/expect). The latter is not fully integrated with Playwright test runner, so make sure to use Playwright's own `expect`.

### 组合来自多个模块的自定义匹配器

🌐 Combine custom matchers from multiple modules

你可以组合来自多个文件或模块的自定义匹配器。

🌐 You can combine custom matchers from multiple files or modules.

fixtures.ts

```ts
import { mergeTests, mergeExpects } from '@playwright/test';
import { test as dbTest, expect as dbExpect } from 'database-test-utils';
import { test as a11yTest, expect as a11yExpect } from 'a11y-test-utils';
export const expect = mergeExpects(dbExpect, a11yExpect);
export const test = mergeTests(dbTest, a11yTest);
```

test.spec.ts

```ts
import { test, expect } from './fixtures';
test('passes', async ({ database }) => {
  await expect(database).toHaveDatabaseUser('admin');
});
```
