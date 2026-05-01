---
title: 对话框
source_url: https://playwright.nodejs.cn/docs/dialogs
fetched_at: 2026-04-29T02:57:28.664Z
---

# 对话框

## 介绍

🌐 Introduction

Playwright 可以与网页对话框进行交互，例如 [`alert`](https://web.nodejs.cn/en-US/docs/Web/API/Window/alert)、[`confirm`](https://web.nodejs.cn/en-US/docs/Web/API/Window/confirm)、[`prompt`](https://web.nodejs.cn/en-US/docs/Web/API/Window/prompt) 以及 [`beforeunload`](https://web.nodejs.cn/en-US/docs/Web/API/Window/beforeunload_event) 确认框。有关打印对话框，请参见 [Print](http://playwright.nodejs.cn/docs/dialogs#print-dialogs)。

🌐 Playwright can interact with the web page dialogs such as [`alert`](https://web.nodejs.cn/en-US/docs/Web/API/Window/alert), [`confirm`](https://web.nodejs.cn/en-US/docs/Web/API/Window/confirm), [`prompt`](https://web.nodejs.cn/en-US/docs/Web/API/Window/prompt) as well as [`beforeunload`](https://web.nodejs.cn/en-US/docs/Web/API/Window/beforeunload_event) confirmation. For print dialogs, see [Print](http://playwright.nodejs.cn/docs/dialogs#print-dialogs).

## alert(), confirm(), prompt() 对话框

🌐 alert(), confirm(), prompt() dialogs

默认情况下，Playwright 会自动关闭对话框，因此你无需手动处理它们。不过，你可以在触发对话框的操作之前注册一个对话框处理程序，以选择 [dialog.accept()](https://playwright.nodejs.cn/docs/api/class-dialog#dialog-accept) 或 [dialog.dismiss()](https://playwright.nodejs.cn/docs/api/class-dialog#dialog-dismiss) 对其进行处理。

🌐 By default, dialogs are auto-dismissed by Playwright, so you don't have to handle them. However, you can register a dialog handler before the action that triggers the dialog to either [dialog.accept()](https://playwright.nodejs.cn/docs/api/class-dialog#dialog-accept) or [dialog.dismiss()](https://playwright.nodejs.cn/docs/api/class-dialog#dialog-dismiss) it.

```ts
page.on('dialog', dialog => dialog.accept());
await page.getByRole('button').click();
```

因此，以下代码片段将永远无法解析：

🌐 As a result, the following snippet will never resolve:

warning

错误！

🌐 WRONG!

```ts
page.on('dialog', dialog => console.log(dialog.message()));
await page.getByRole('button').click(); // Will hang here
```

## 卸载前对话框

🌐 beforeunload dialog

当调用带有为真值的 [runBeforeUnload](https://playwright.nodejs.cn/docs/api/class-page#page-close-option-run-before-unload) 参数的 [page.close()](https://playwright.nodejs.cn/docs/api/class-page#page-close) 时，页面会执行其卸载处理程序。这是 [page.close()](https://playwright.nodejs.cn/docs/api/class-page#page-close) 唯一不等待页面实际关闭的情况，因为在操作结束时页面可能仍然保持打开状态。

🌐 When [page.close()](https://playwright.nodejs.cn/docs/api/class-page#page-close) is invoked with the truthy [runBeforeUnload](https://playwright.nodejs.cn/docs/api/class-page#page-close-option-run-before-unload) value, the page runs its unload handlers. This is the only case when [page.close()](https://playwright.nodejs.cn/docs/api/class-page#page-close) does not wait for the page to actually close, because it might be that the page stays open in the end of the operation.

你可以注册一个对话处理程序来自行处理 `beforeunload` 对话：

🌐 You can register a dialog handler to handle the `beforeunload` dialog yourself:

```ts
page.on('dialog', async dialog => {
  assert(dialog.type() === 'beforeunload');  await dialog.dismiss();
});
await page.close({ runBeforeUnload: true });
```

## 打印对话框

🌐 Print dialogs

为了断言通过 [`window.print`](https://web.nodejs.cn/en-US/docs/Web/API/Window/print) 触发了打印对话框，你可以使用以下代码片段：

🌐 In order to assert that a print dialog via [`window.print`](https://web.nodejs.cn/en-US/docs/Web/API/Window/print) was triggered, you can use the following snippet:

```ts
await page.goto('<url>');
await page.evaluate('(() => {window.waitForPrintDialog = new Promise(f => window.print = f);
})()');
await page.getByText('Print it!').click();
await page.waitForFunction('window.waitForPrintDialog');
```

这将等待在按钮被点击后打印对话框打开。确保在点击按钮或页面加载后评估脚本。

🌐 This will wait for the print dialog to be opened after the button is clicked. Make sure to evaluate the script before clicking the button / after the page is loaded.
