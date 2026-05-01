---
title: 句柄
source_url: https://playwright.nodejs.cn/docs/handles
fetched_at: 2026-04-29T02:57:28.664Z
---

# 句柄

## 介绍

🌐 Introduction

Playwright 可以创建指向页面 DOM 元素或页面内其他对象的句柄。这些句柄存在于 Playwright 进程中，而实际的对象存在于浏览器中。句柄有两种类型：

🌐 Playwright can create handles to the page DOM elements or any other objects inside the page. These handles live in the Playwright process, whereas the actual objects live in the browser. There are two types of handles:

*   [JSHandle](https://playwright.nodejs.cn/docs/api/class-jshandle "JSHandle") 用于引用页面中的任何 JavaScript 对象
*   [ElementHandle](https://playwright.nodejs.cn/docs/api/class-elementhandle "ElementHandle") 用于引用页面中的 DOM 元素，它具有额外的方法，可对这些元素执行操作并断言它们的属性。

由于页面中的任何 DOM 元素也是一个 JavaScript 对象，因此任何 [ElementHandle](https://playwright.nodejs.cn/docs/api/class-elementhandle "ElementHandle") 也是一个 [JSHandle](https://playwright.nodejs.cn/docs/api/class-jshandle "JSHandle")。

🌐 Since any DOM element in the page is also a JavaScript object, any [ElementHandle](https://playwright.nodejs.cn/docs/api/class-elementhandle "ElementHandle") is a [JSHandle](https://playwright.nodejs.cn/docs/api/class-jshandle "JSHandle") as well.

句柄用于对页面中的实际对象执行操作。你可以在句柄上进行评估、获取句柄属性、将句柄作为评估参数传递、将页面对象序列化为 JSON 等。有关这些功能和方法，请参阅 [JSHandle](https://playwright.nodejs.cn/docs/api/class-jshandle "JSHandle") 类的 API。

🌐 Handles are used to perform operations on those actual objects in the page. You can evaluate on a handle, get handle properties, pass handle as an evaluation parameter, serialize page object into JSON etc. See the [JSHandle](https://playwright.nodejs.cn/docs/api/class-jshandle "JSHandle") class API for these and methods.

### API 参考

🌐 API reference

*   [JSHandle](https://playwright.nodejs.cn/docs/api/class-jshandle "JSHandle")
*   [ElementHandle](https://playwright.nodejs.cn/docs/api/class-elementhandle "ElementHandle")

这是获取 [JSHandle](https://playwright.nodejs.cn/docs/api/class-jshandle "JSHandle") 的最简单方法。

🌐 Here is the easiest way to obtain a [JSHandle](https://playwright.nodejs.cn/docs/api/class-jshandle "JSHandle").

```ts
const jsHandle = await page.evaluateHandle('window');
//  Use jsHandle for evaluations.
```

## 元素句柄

🌐 Element Handles

当需要 [ElementHandle](https://playwright.nodejs.cn/docs/api/class-elementhandle "ElementHandle") 时，建议使用 [page.waitForSelector()](https://playwright.nodejs.cn/docs/api/class-page#page-wait-for-selector) 或 [frame.waitForSelector()](https://playwright.nodejs.cn/docs/api/class-frame#frame-wait-for-selector) 方法来获取它。这些 API 会等待元素被附加并可见。

🌐 When [ElementHandle](https://playwright.nodejs.cn/docs/api/class-elementhandle "ElementHandle") is required, it is recommended to fetch it with the [page.waitForSelector()](https://playwright.nodejs.cn/docs/api/class-page#page-wait-for-selector) or [frame.waitForSelector()](https://playwright.nodejs.cn/docs/api/class-frame#frame-wait-for-selector) methods. These APIs wait for the element to be attached and visible.

```ts
// Get the element handleconst elementHandle = page.waitForSelector('#box');
// Assert bounding box for the elementconst boundingBox = await elementHandle.boundingBox();
expect(boundingBox.width).toBe(100);
// Assert attribute for the elementconst classNames = await elementHandle.getAttribute('class');
expect(classNames.includes('highlighted')).toBeTruthy();
```

## 句柄作为参数

🌐 Handles as parameters

句柄可以传入 [page.evaluate()](https://playwright.nodejs.cn/docs/api/class-page#page-evaluate) 及类似方法。以下示例在页面中创建了一个新数组，用数据初始化它，并将该数组的句柄返回到 Playwright 中。然后在后续的评估中使用该句柄：

🌐 Handles can be passed into the [page.evaluate()](https://playwright.nodejs.cn/docs/api/class-page#page-evaluate) and similar methods. The following snippet creates a new array in the page, initializes it with data and returns a handle to this array into Playwright. It then uses the handle in subsequent evaluations:

```ts
// Create new array in page.const myArrayHandle = await page.evaluateHandle(() => {
  window.myArray = [1];  return myArray;
});
// Get the length of the array.const length = await page.evaluate(a => a.length, myArrayHandle);
// Add one more element to the array using the handleawait page.evaluate(arg => arg.myArray.push(arg.newElement), {
  myArray: myArrayHandle,  newElement: 2});
// Release the object when it's no longer needed.await myArrayHandle.dispose();
```

## 句柄生命周期

🌐 Handle Lifecycle

可以使用页面方法获取句柄，例如 [page.evaluateHandle()](https://playwright.nodejs.cn/docs/api/class-page#page-evaluate-handle)、[page.$()](https://playwright.nodejs.cn/docs/api/class-page#page-query-selector) 或 [page.$$()](https://playwright.nodejs.cn/docs/api/class-page#page-query-selector-all)，或者它们的框架对应方法 [frame.evaluateHandle()](https://playwright.nodejs.cn/docs/api/class-frame#frame-evaluate-handle)、[frame.$()](https://playwright.nodejs.cn/docs/api/class-frame#frame-query-selector) 或 [frame.$$()](https://playwright.nodejs.cn/docs/api/class-frame#frame-query-selector-all)。创建后，句柄将保留对象，不会被[垃圾回收](https://web.nodejs.cn/en-US/docs/Web/JavaScript/Memory_Management)回收，除非页面导航或通过 [jsHandle.dispose()](https://playwright.nodejs.cn/docs/api/class-jshandle#js-handle-dispose) 方法手动释放句柄。

🌐 Handles can be acquired using the page methods such as [page.evaluateHandle()](https://playwright.nodejs.cn/docs/api/class-page#page-evaluate-handle), [page.$()](https://playwright.nodejs.cn/docs/api/class-page#page-query-selector) or [page.$$()](https://playwright.nodejs.cn/docs/api/class-page#page-query-selector-all) or their frame counterparts [frame.evaluateHandle()](https://playwright.nodejs.cn/docs/api/class-frame#frame-evaluate-handle), [frame.$()](https://playwright.nodejs.cn/docs/api/class-frame#frame-query-selector) or [frame.$$()](https://playwright.nodejs.cn/docs/api/class-frame#frame-query-selector-all). Once created, handles will retain object from [garbage collection](https://web.nodejs.cn/en-US/docs/Web/JavaScript/Memory_Management) unless page navigates or the handle is manually disposed via the [jsHandle.dispose()](https://playwright.nodejs.cn/docs/api/class-jshandle#js-handle-dispose) method.

### API 参考

🌐 API reference

*   [JSHandle](https://playwright.nodejs.cn/docs/api/class-jshandle "JSHandle")
*   [ElementHandle](https://playwright.nodejs.cn/docs/api/class-elementhandle "ElementHandle")
*   [elementHandle.boundingBox()](https://playwright.nodejs.cn/docs/api/class-elementhandle#element-handle-bounding-box)
*   [elementHandle.getAttribute()](https://playwright.nodejs.cn/docs/api/class-elementhandle#element-handle-get-attribute)
*   [elementHandle.innerText()](https://playwright.nodejs.cn/docs/api/class-elementhandle#element-handle-inner-text)
*   [elementHandle.innerHTML()](https://playwright.nodejs.cn/docs/api/class-elementhandle#element-handle-inner-html)
*   [elementHandle.textContent()](https://playwright.nodejs.cn/docs/api/class-elementhandle#element-handle-text-content)
*   [jsHandle.evaluate()](https://playwright.nodejs.cn/docs/api/class-jshandle#js-handle-evaluate)
*   [page.evaluateHandle()](https://playwright.nodejs.cn/docs/api/class-page#page-evaluate-handle)
*   [page.$()](https://playwright.nodejs.cn/docs/api/class-page#page-query-selector)
*   [page.$$()](https://playwright.nodejs.cn/docs/api/class-page#page-query-selector-all)

## Locator 与 ElementHandle

🌐 Locator vs ElementHandle

caution

我们仅建议在需要对静态页面进行大量 DOM 遍历的少数情况下使用 [ElementHandle](https://playwright.nodejs.cn/docs/api/class-elementhandle "ElementHandle")。对于所有用户操作和断言，请改用定位器 (locator)。

🌐 We only recommend using [ElementHandle](https://playwright.nodejs.cn/docs/api/class-elementhandle "ElementHandle") in the rare cases when you need to perform extensive DOM traversal on a static page. For all user actions and assertions use locator instead.

[Locator](https://playwright.nodejs.cn/docs/api/class-locator "Locator") 和 [ElementHandle](https://playwright.nodejs.cn/docs/api/class-elementhandle "ElementHandle") 之间的区别在于，后者指向特定的元素，而 Locator 则包含了如何获取该元素的逻辑。

🌐 The difference between the [Locator](https://playwright.nodejs.cn/docs/api/class-locator "Locator") and [ElementHandle](https://playwright.nodejs.cn/docs/api/class-elementhandle "ElementHandle") is that the latter points to a particular element, while Locator captures the logic of how to retrieve that element.

在下面的示例中，handle 指向页面上的特定 DOM 元素。如果该元素的文本发生变化，或者被 React 用来渲染一个完全不同的组件，handle 仍然指向那个已经过时的 DOM 元素。这可能导致意想不到的行为。

🌐 In the example below, handle points to a particular DOM element on page. If that element changes text or is used by React to render an entirely different component, handle is still pointing to that very stale DOM element. This can lead to unexpected behaviors.

```ts
const handle = await page.$('text=Submit');
// ...await handle.hover();
await handle.click();
```

使用定位器时，每次使用定位器时，都会使用选择器在页面中定位最新的 DOM 元素。因此，在下面的代码片段中，底层的 DOM 元素将被定位两次。

🌐 With the locator, every time the locator is used, up-to-date DOM element is located in the page using the selector. So in the snippet below, underlying DOM element is going to be located twice.

```ts
const locator = page.getByText('Submit');
// ...await locator.hover();
await locator.click();
```
