---
title: 可扩展性
source_url: https://playwright.nodejs.cn/docs/extensibility
fetched_at: 2026-04-29T02:57:28.664Z
---

# 可扩展性

## 自定义选择器引擎

🌐 Custom selector engines

Playwright 支持自定义选择器引擎，可以通过 [selectors.register()](https://playwright.nodejs.cn/docs/api/class-selectors#selectors-register) 注册。

🌐 Playwright supports custom selector engines, registered with [selectors.register()](https://playwright.nodejs.cn/docs/api/class-selectors#selectors-register).

选择器引擎应具有以下属性：

🌐 Selector engine should have the following properties:

*   `query` 函数用于查询相对于 `root` 的第一个匹配 `selector` 的元素。
*   `queryAll` 函数用于查询相对于 `root` 的所有匹配 `selector` 的元素。

默认情况下，引擎直接在框架的 JavaScript 上下文中运行，例如，可以调用应用定义的函数。要将引擎与框架中的任何 JavaScript 隔离，但仍保留对 DOM 的访问，请使用 `{contentScript: true}` 选项注册引擎。内容脚本引擎更安全，因为它不受全局对象的任何篡改影响，例如修改 `Node.prototype` 方法。所有内置的选择器引擎都作为内容脚本运行。请注意，当引擎与其他自定义引擎一起使用时，运行为内容脚本无法保证。

🌐 By default the engine is run directly in the frame's JavaScript context and, for example, can call an application-defined function. To isolate the engine from any JavaScript in the frame, but leave access to the DOM, register the engine with `{contentScript: true}` option. Content script engine is safer because it is protected from any tampering with the global objects, for example altering `Node.prototype` methods. All built-in selector engines run as content scripts. Note that running as a content script is not guaranteed when the engine is used together with other custom engines.

创建页面之前必须注册选择器。

🌐 Selectors must be registered before creating the page.

注册根据标签名称查询元素的选择器引擎的示例：

🌐 An example of registering selector engine that queries elements based on a tag name:

baseTest.ts

```json
import { test as base } from '@playwright/test';export { expect } from '@playwright/test';// Must be a function that evaluates to a selector engine instance.const createTagNameEngine = () => ({  // Returns the first element matching given selector in the root's subtree.  query(root, selector) {    return root.querySelector(selector);  },  // Returns all elements matching given selector in the root's subtree.  queryAll(root, selector) {    return Array.from(root.querySelectorAll(selector));  }});export const test = base.extend<{}, { selectorRegistration: void }>({  // Register selectors once per worker.  selectorRegistration: [async ({ playwright }, use) => {    // Register the engine. Selectors will be prefixed with "tag=".    await playwright.selectors.register('tag', createTagNameEngine);    await use();  }, { scope: 'worker', auto: true }],});
```

example.spec.ts

```ts
import { test, expect } from './baseTest';
test('selector engine test', async ({ page }) => {
  // Now we can use 'tag=' selectors.  const button = page.locator('tag=button');  await button.click();  // We can combine it with built-in locators.  await page.locator('tag=div').getByText('Click me').click();  // We can use it in any methods supporting selectors.  await expect(page.locator('tag=button')).toHaveCount(3);
});
```
