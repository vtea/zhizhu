---
title: 导航
source_url: https://playwright.nodejs.cn/docs/navigations
fetched_at: 2026-04-29T02:57:28.664Z
---

# 导航

## 介绍

🌐 Introduction

Playwright 可以导航到 URL 并处理由页面交互引起的导航。

🌐 Playwright can navigate to URLs and handle navigations caused by the page interactions.

## 基本导航

🌐 Basic navigation

最简单的导航形式是打开 URL：

🌐 Simplest form of a navigation is opening a URL:

```ts
// Navigate the pageawait page.goto('https://example.com');
```

上面的代码会加载页面，并等待网页触发 [load](https://web.nodejs.cn/en-US/docs/Web/API/Window/load_event) 事件。当整个页面及其所有依赖资源（如样式表、脚本、iframe 和图片）加载完成时，会触发 load 事件。

🌐 The code above loads the page and waits for the web page to fire the [load](https://web.nodejs.cn/en-US/docs/Web/API/Window/load_event) event. The load event is fired when the whole page has loaded, including all dependent resources such as stylesheets, scripts, iframes, and images.

note

如果页面在 `load` 之前进行客户端重定向，[page.goto()](https://playwright.nodejs.cn/docs/api/class-page#page-goto) 将等待重定向后的页面触发 `load` 事件。

🌐 If the page does a client-side redirect before `load`, [page.goto()](https://playwright.nodejs.cn/docs/api/class-page#page-goto) will wait for the redirected page to fire the `load` event.

## 页面何时加载？

🌐 When is the page loaded?

现代页面在 `load` 事件触发后执行许多活动。它们会延迟获取数据、填充用户界面、在 `load` 事件触发后加载昂贵的资源、脚本和样式。无法确定页面何时是 `loaded`，这取决于页面、框架等。那么，你什么时候可以开始与它交互呢？

🌐 Modern pages perform numerous activities after the `load` event was fired. They fetch data lazily, populate UI, load expensive resources, scripts and styles after the `load` event was fired. There is no way to tell that the page is `loaded`, it depends on the page, framework, etc. So when can you start interacting with it?

在 Playwright 中，你可以随时与页面进行交互。它会自动等待目标元素变得可操作。

🌐 In Playwright you can interact with the page at any moment. It will automatically wait for the target elements to become [actionable](https://playwright.nodejs.cn/docs/actionability).

```ts
// Navigate and click element// Click will auto-wait for the elementawait page.goto('https://example.com');
await page.getByText('Example Domain').click();
```

对于上面的场景，Playwright 将等待文本变得可见，等待该元素的其余可操作性检查通过，然后单击它。

🌐 For the scenario above, Playwright will wait for the text to become visible, will wait for the rest of the actionability checks to pass for that element, and will click it.

Playwright 的操作速度非常快——一看到按钮就会点击它。在一般情况下，你不需要担心所有资源是否已经加载完毕等问题。

🌐 Playwright operates as a very fast user - the moment it sees the button, it clicks it. In the general case, you don't need to worry about whether all the resources loaded, etc.

## Hydration

在某个时间点，你可能会遇到这样的用例：Playwright 执行了一个操作，但似乎什么都没发生。或者你在输入框中输入一些文本，但它会消失。造成这种情况的最可能原因是页面 [hydration]([https://en.wikipedia.org/wiki/Hydration_(web_development)](https://en.wikipedia.org/wiki/Hydration_(web_development)) 不佳。

🌐 At some point in time, you'll stumble upon a use case where Playwright performs an action, but nothing seemingly happens. Or you enter some text into the input field and it will disappear. The most probable reason behind that is a poor page [hydration](https://en.wikipedia.org/wiki/Hydration_(web_development)).

当页面被水化时，首先会将页面的静态版本发送到浏览器。然后动态部分被发送，页面就变成“上线”了。作为一个非常快速的用户，Playwright 一看到页面就会开始与它互动。如果页面上的按钮被启用，但监听器还没被添加，Playwright会完成任务，但点击不会有任何效果。

🌐 When page is hydrated, first, a static version of the page is sent to the browser. Then the dynamic part is sent and the page becomes "live". As a very fast user, Playwright will start interacting with the page the moment it sees it. And if the button on a page is enabled, but the listeners have not yet been added, Playwright will do its job, but the click won't have any effect.

验证页面是否存在水合性能差的一个简单方法是打开 Chrome 开发者工具，在网络面板中选择“慢速 3G”网络模拟，然后重新加载页面。一旦看到感兴趣的元素，与其互动。你会发现按钮点击会被忽略，输入的文本会被后续页面加载代码重置。解决此问题的正确方法是确保所有交互控件在水合完成之前保持禁用状态，等待页面完全可用后再启用。

🌐 A simple way to verify if your page suffers from a poor hydration is to open Chrome DevTools, pick "Slow 3G" network emulation in the Network panel and reload the page. Once you see the element of interest, interact with it. You'll see that the button clicks will be ignored and the entered text will be reset by the subsequent page load code. The right fix for this issue is to make sure that all the interactive controls are disabled until after the hydration, when the page is fully functional.

## 等待导航

🌐 Waiting for navigation

点击一个元素可能会触发多次导航。在这种情况下，建议显式地使用 [page.waitForURL()](https://playwright.nodejs.cn/docs/api/class-page#page-wait-for-url) 等待特定的 URL。

🌐 Clicking an element could trigger multiple navigations. In these cases, it is recommended to explicitly [page.waitForURL()](https://playwright.nodejs.cn/docs/api/class-page#page-wait-for-url) to a specific url.

```ts
await page.getByText('Click me').click();
await page.waitForURL('**/login');
```

## 导航事件

🌐 Navigation events

Playwright 将在页面中显示新文档的过程分为**导航**和**加载**。

🌐 Playwright splits the process of showing a new document in a page into **navigation** and **loading**.

**导航开始** 是通过更改页面 URL 或与页面互动（例如，点击链接）触发的。导航意图可能会被取消，例如，当遇到无法解析的 DNS 地址，或者被转化为文件下载。

**导航已提交**是指响应头已被解析且会话历史已更新。只有在导航成功（已提交）之后，页面才开始**加载**文档。

**加载** 包括通过网络获取剩余的响应主体、解析、执行脚本以及触发加载事件：

*   [page.url()](https://playwright.nodejs.cn/docs/api/class-page#page-url) 已设置为新的 URL
*   文档内容通过网络加载并解析
*   [page.on('domcontentloaded')](https://playwright.nodejs.cn/docs/api/class-page#page-event-dom-content-loaded) 事件被触发
*   页面执行一些脚本并加载样式表和图片等资源
*   [page.on('load')](https://playwright.nodejs.cn/docs/api/class-page#page-event-load) 事件被触发
*   页面执行动态加载的脚本
