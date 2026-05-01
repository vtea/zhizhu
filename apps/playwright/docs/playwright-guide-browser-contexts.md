---
title: 隔离
source_url: https://playwright.nodejs.cn/docs/browser-contexts
fetched_at: 2026-04-29T02:57:28.664Z
---

# 隔离

## 介绍

🌐 Introduction

使用 Playwright 编写的测试在称为浏览器上下文的独立干净环境中执行。这种隔离模型提高了可重复性，并防止了连锁测试失败。

🌐 Tests written with Playwright execute in isolated clean-slate environments called browser contexts. This isolation model improves reproducibility and prevents cascading test failures.

## 什么是测试隔离？

🌐 What is Test Isolation?

测试隔离是指每个测试完全独立于其他测试。每个测试都独立运行，不依赖于任何其他测试。这意味着每个测试都有自己的本地存储、会话存储、Cookie 等。Playwright 通过使用 [BrowserContext](https://playwright.nodejs.cn/docs/api/class-browsercontext "BrowserContext") 实现这一点，[BrowserContext](https://playwright.nodejs.cn/docs/api/class-browsercontext "BrowserContext") 相当于类似隐身模式的配置文件。它们创建起来快速且成本低，并且完全隔离，即使在单个浏览器中运行也是如此。Playwright 会为每个测试创建一个上下文，并在该上下文中提供一个默认的 [Page](https://playwright.nodejs.cn/docs/api/class-page "Page")。

🌐 Test Isolation is when each test is completely isolated from another test. Every test runs independently from any other test. This means that each test has its own local storage, session storage, cookies etc. Playwright achieves this using [BrowserContext](https://playwright.nodejs.cn/docs/api/class-browsercontext "BrowserContext")s which are equivalent to incognito-like profiles. They are fast and cheap to create and are completely isolated, even when running in a single browser. Playwright creates a context for each test, and provides a default [Page](https://playwright.nodejs.cn/docs/api/class-page "Page") in that context.

## 为什么测试隔离很重要？

🌐 Why is Test Isolation Important?

*   失败不累积。如果一个测试失败，不会影响其他测试。
*   易于调试错误或不稳定，因为你可以根据需要多次运行单个测试。
*   并行运行、分片等时不必考虑顺序。

## 测试隔离的两种方法

🌐 Two Ways of Test Isolation

在测试隔离方面有两种不同的策略：从头开始或者在测试之间进行清理。在测试之间进行清理的问题是，很容易忘记清理，而且有些东西无法清理，例如“已访问的链接”。一个测试的状态可能会泄漏到下一个测试，这可能导致测试失败，并使调试更加困难，因为问题可能来自另一个测试。从头开始意味着一切都是全新的，所以如果测试失败，你只需要在该测试内部查找原因进行调试。

🌐 There are two different strategies when it comes to Test Isolation: start from scratch or cleanup in between. The problem with cleaning up in between tests is that it can be easy to forget to clean up and some things are impossible to clean up such as "visited links". State from one test can leak into the next test which could cause your test to fail and make debugging harder as the problem comes from another test. Starting from scratch means everything is new, so if the test fails you only have to look within that test to debug.

🌐 How Playwright Achieves Test Isolation

Playwright 使用浏览器上下文来实现测试隔离。每个测试都有自己的浏览器上下文。运行测试时，每次都会创建一个新的浏览器上下文。使用 Playwright 作为测试运行器时，默认会创建浏览器上下文。否则，你可以手动创建浏览器上下文。

🌐 Playwright uses browser contexts to achieve Test Isolation. Each test has its own Browser Context. Running the test creates a new browser context each time. When using Playwright as a Test Runner, browser contexts are created by default. Otherwise, you can create browser contexts manually.

*   Test
*   Library

```ts
import { test } from '@playwright/test';
test('example test', async ({ page, context }) => {
  // "context" is an isolated BrowserContext, created for this specific test.  // "page" belongs to this context.});
test('another test', async ({ page, context }) => {
  // "context" and "page" in this second test are completely  // isolated from the first test.});
```

浏览器上下文还可以用于模拟涉及移动设备、权限、区域设置和配色方案的多页面场景。更多详情请查看我们的 [模拟](https://playwright.nodejs.cn/docs/emulation) 指南。

🌐 Browser contexts can also be used to emulate multi-page scenarios involving mobile devices, permissions, locale and color scheme. Check out our [Emulation](https://playwright.nodejs.cn/docs/emulation) guide for more details.

## 单个测试中的多个上下文

🌐 Multiple Contexts in a Single Test

Playwright 可以在单个场景中创建多个浏览器上下文。当你想测试多用户功能，比如聊天时，这非常有用。

🌐 Playwright can create multiple browser contexts within a single scenario. This is useful when you want to test for multi-user functionality, like a chat.

*   Test
*   Library

```ts
import { test } from '@playwright/test';
test('admin and user', async ({ browser }) => {
  // Create two isolated browser contexts  const adminContext = await browser.newContext();  const userContext = await browser.newContext();  // Create pages and interact with contexts independently  const adminPage = await adminContext.newPage();  const userPage = await userContext.newPage();
});
```
