---
title: 评估 JavaScript
source_url: https://playwright.nodejs.cn/docs/evaluating
fetched_at: 2026-04-29T02:57:28.664Z
---

# 评估 JavaScript

🌐 Introduction

Playwright 脚本在你的 Playwright 环境中运行。你的页面脚本在浏览器页面环境中运行。这些环境不会相交，它们在不同的虚拟机中、不同的进程中运行，甚至可能在不同的计算机上运行。

🌐 Playwright scripts run in your Playwright environment. Your page scripts run in the browser page environment. Those environments don't intersect, they are running in different virtual machines in different processes and even potentially on different computers.

[page.evaluate()](https://playwright.nodejs.cn/docs/api/class-page#page-evaluate) API 可以在网页的上下文中运行 JavaScript 函数，并将结果带回 Playwright 环境。像 `window` 和 `document` 这样的浏览器全局变量可以在 `evaluate` 中使用。

🌐 The [page.evaluate()](https://playwright.nodejs.cn/docs/api/class-page#page-evaluate) API can run a JavaScript function in the context of the web page and bring results back to the Playwright environment. Browser globals like `window` and `document` can be used in `evaluate`.

```ts
const href = await page.evaluate(() => document.location.href);
```

如果结果是 Promise 或者函数是异步的，则评估将自动等待直到解决：

🌐 If the result is a Promise or if the function is asynchronous evaluate will automatically wait until it's resolved:

```ts
const status = await page.evaluate(async () => {
  const response = await fetch(location.href);  return response.status;
});
```

## 不同的环境

🌐 Different environments

评估的脚本在浏览器环境中运行，而你的测试在测试环境中运行。这意味着你不能在页面中使用测试中的变量，反之亦然。相反，你应该将它们显式地作为参数传递。

🌐 Evaluated scripts run in the browser environment, while your test runs in a testing environments. This means you cannot use variables from your test in the page and vice versa. Instead, you should pass them explicitly as an argument.

以下代码片段是**错误的**，因为它直接使用了变量：

🌐 The following snippet is **WRONG** because it uses the variable directly:

```ts
const data = 'some data';
const result = await page.evaluate(() => {
  // WRONG: there is no "data" in the web page.  window.myApp.use(data);
});
```

以下代码段是**正确的**，因为它将值作为参数显式传递：

🌐 The following snippet is **CORRECT** because it passes the value explicitly as an argument:

```ts
const data = 'some data';
// Pass |data| as a parameter.const result = await page.evaluate(data => {
  window.myApp.use(data);
}, data);
```

## 评价参数

🌐 Evaluation Argument

像 [page.evaluate()](https://playwright.nodejs.cn/docs/api/class-page#page-evaluate) 这样的 Playwright 评估方法接受一个可选的单一参数。该参数可以是 [Serializable](https://web.nodejs.cn/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/stringify#Description "Serializable") 值和 [JSHandle](https://playwright.nodejs.cn/docs/api/class-jshandle "JSHandle") 实例的组合。Handle 会自动转换为它们所表示的值。

🌐 Playwright evaluation methods like [page.evaluate()](https://playwright.nodejs.cn/docs/api/class-page#page-evaluate) take a single optional argument. This argument can be a mix of [Serializable](https://web.nodejs.cn/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/stringify#Description "Serializable") values and [JSHandle](https://playwright.nodejs.cn/docs/api/class-jshandle "JSHandle") instances. Handles are automatically converted to the value they represent.

```json
// A primitive value.await page.evaluate(num => num, 42);// An array.await page.evaluate(array => array.length, [1, 2, 3]);// An object.await page.evaluate(object => object.foo, { foo: 'bar' });// A single handle.const button = await page.evaluateHandle('window.button');await page.evaluate(button => button.textContent, button);// Alternative notation using JSHandle.evaluate.await button.evaluate((button, from) => button.textContent.substring(from), 5);// Object with multiple handles.const button1 = await page.evaluateHandle('window.button1');const button2 = await page.evaluateHandle('window.button2');await page.evaluate(    o => o.button1.textContent + o.button2.textContent,    { button1, button2 });// Object destructuring works. Note that property names must match// between the destructured object and the argument.// Also note the required parenthesis.await page.evaluate(    ({ button1, button2 }) => button1.textContent + button2.textContent,    { button1, button2 });// Array works as well. Arbitrary names can be used for destructuring.// Note the required parenthesis.await page.evaluate(    ([b1, b2]) => b1.textContent + b2.textContent,    [button1, button2]);// Any mix of serializables and handles works.await page.evaluate(    x => x.button1.textContent + x.list[0].textContent + String(x.foo),    { button1, list: [button2], foo: null });
```

## 初始化脚本

🌐 Init scripts

有时在页面开始加载之前评估某些内容会比较方便。例如，你可能想设置一些模拟或测试数据。

🌐 Sometimes it is convenient to evaluate something in the page before it starts loading. For example, you might want to setup some mocks or test data.

在这种情况下，请使用 [page.addInitScript()](https://playwright.nodejs.cn/docs/api/class-page#page-add-init-script) 或 [browserContext.addInitScript()](https://playwright.nodejs.cn/docs/api/class-browsercontext#browser-context-add-init-script)。在下面的示例中，我们将用一个常量值替换 `Math.random()`。

🌐 In this case, use [page.addInitScript()](https://playwright.nodejs.cn/docs/api/class-page#page-add-init-script) or [browserContext.addInitScript()](https://playwright.nodejs.cn/docs/api/class-browsercontext#browser-context-add-init-script). In the example below, we will replace `Math.random()` with a constant value.

首先，创建一个包含模拟的 `preload.js` 文件。

🌐 First, create a `preload.js` file that contains the mock.

```
// preload.jsMath.random = () => 42;
```

接下来，将初始化脚本添加到页面。

🌐 Next, add init script to the page.

```ts
import { test, expect } from '@playwright/test';
import path from 'path';
test.beforeEach(async ({ page }) => {
  // Add script for every test in the beforeEach hook.  // Make sure to correctly resolve the script path.  await page.addInitScript({ path: path.resolve(__dirname, '../mocks/preload.js') });
});
```

或者，你可以传入一个函数，而不是创建一个预加载脚本文件。这对于短小或一次性的脚本更方便。你也可以通过这种方式传递参数。

```ts
import { test, expect } from '@playwright/test';
// Add script for every test in the beforeEach hook.test.beforeEach(async ({ page }) => {
  const value = 42;  await page.addInitScript(value => {
  Math.random = () => value;  }, value);
});
```
