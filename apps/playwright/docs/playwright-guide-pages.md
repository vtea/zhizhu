---
title: 页面
source_url: https://playwright.nodejs.cn/docs/pages
fetched_at: 2026-04-29T02:57:28.664Z
---

# 页面

## 页面

🌐 Pages

每个 [BrowserContext](https://playwright.nodejs.cn/docs/api/class-browsercontext "BrowserContext") 可以有多个页面。[Page](https://playwright.nodejs.cn/docs/api/class-page "Page") 指的是浏览器上下文中的单个标签页或弹出窗口。它应被用来导航到 URL 并与页面内容进行交互。

🌐 Each [BrowserContext](https://playwright.nodejs.cn/docs/api/class-browsercontext "BrowserContext") can have multiple pages. A [Page](https://playwright.nodejs.cn/docs/api/class-page "Page") refers to a single tab or a popup window within a browser context. It should be used to navigate to URLs and interact with the page content.

```ts
// Create a page.const page = await context.newPage();
// Navigate explicitly, similar to entering a URL in the browser.await page.goto('http://example.com');
// Fill an input.await page.locator('#search').fill('query');
// Navigate implicitly by clicking a link.await page.locator('#submit').click();
// Expect a new url.console.log(page.url());
```

## 多页

🌐 Multiple pages

每个浏览器上下文可以托管多个页面（选项卡）。

🌐 Each browser context can host multiple pages (tabs).

*   每个页面的行为都像是一个专注的、活跃的页面。无需将页面置于前端。
*   上下文内的页面遵循上下文级模拟，例如视口大小、自定义网络路由或浏览器区域设置。

```ts
// Create two pagesconst pageOne = await context.newPage();
const pageTwo = await context.newPage();
// Get pages of a browser contextconst allPages = context.pages();
```

## 处理新页面

🌐 Handling new pages

浏览器上下文中的 `page` 事件可以用来获取在该上下文中创建的新页面。这可以用来处理由 `target="_blank"` 链接打开的新页面。

🌐 The `page` event on browser contexts can be used to get new pages that are created in the context. This can be used to handle new pages opened by `target="_blank"` links.

```ts
// Start waiting for new page before clicking. Note no await.const pagePromise = context.waitForEvent('page');
await page.getByText('open new tab').click();
const newPage = await pagePromise;
// Interact with the new page normally.await newPage.getByRole('button').click();
console.log(await newPage.title());
```

如果触发新页面的操作未知，则可以使用以下模式。

🌐 If the action that triggers the new page is unknown, the following pattern can be used.

```ts
// Get all new pages (including popups) in the contextcontext.on('page', async page => {
  await page.waitForLoadState();  console.log(await page.title());
});
```

## 处理弹出窗口

🌐 Handling popups

如果页面打开了一个弹出窗口（例如由 `target="_blank"` 链接打开的页面），你可以通过监听页面上的 `popup` 事件来获取对它的引用。

🌐 If the page opens a pop-up (e.g. pages opened by `target="_blank"` links), you can get a reference to it by listening to the `popup` event on the page.

除了 `browserContext.on('page')` 事件之外，还会触发此事件，但仅针对与此页面相关的弹出窗口。

🌐 This event is emitted in addition to the `browserContext.on('page')` event, but only for popups relevant to this page.

```ts
// Start waiting for popup before clicking. Note no await.const popupPromise = page.waitForEvent('popup');
await page.getByText('open the popup').click();
const popup = await popupPromise;
// Interact with the new popup normally.await popup.getByRole('button').click();
console.log(await popup.title());
```

如果触发弹出窗口的操作未知，则可以使用以下模式。

🌐 If the action that triggers the popup is unknown, the following pattern can be used.

```ts
// Get all popups when they openpage.on('popup', async popup => {
  await popup.waitForLoadState();  console.log(await popup.title());
});
```
