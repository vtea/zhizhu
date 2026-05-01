---
title: 自动等待
source_url: https://playwright.nodejs.cn/docs/actionability
fetched_at: 2026-04-29T02:57:28.664Z
---

# 自动等待

## 介绍

🌐 Introduction

在执行操作之前，Playwright 会对元素进行一系列可操作性检查，以确保这些操作按预期执行。它会自动等待所有相关检查通过，然后才执行请求的操作。如果在指定的 `timeout` 内所需的检查未通过，操作将以 `TimeoutError` 失败。

🌐 Playwright performs a range of actionability checks on the elements before making actions to ensure these actions behave as expected. It auto-waits for all the relevant checks to pass and only then performs the requested action. If the required checks do not pass within the given `timeout`, action fails with the `TimeoutError`.

例如，对于 [locator.click()](https://playwright.nodejs.cn/docs/api/class-locator#locator-click)，Playwright 将确保：

🌐 For example, for [locator.click()](https://playwright.nodejs.cn/docs/api/class-locator#locator-click), Playwright will ensure that:

*   定位器解析为一个元素
*   元素是[可见](http://playwright.nodejs.cn/docs/actionability#visible "Visible")
*   元素是[稳定](http://playwright.nodejs.cn/docs/actionability#stable "Stable")的，即未在动画或动画已完成
*   元素[接收事件](http://playwright.nodejs.cn/docs/actionability#receives-events "Receives Events")，即未被其他元素遮挡
*   元素[已启用](http://playwright.nodejs.cn/docs/actionability#enabled "Enabled")

以下是针对每个操作执行的可操作性检查的完整列表：

🌐 Here is the complete list of actionability checks performed for each action:

| 操作 | [可见] | [稳定] | [接收事件] | [已启用] | [可编辑] |

| :- | :-: | :-: | :-: | :-: | :-: |

| [locator.check()](https://playwright.nodejs.cn/docs/api/class-locator#locator-check) | 是 | 是 | 是 | 是 | - |

| [locator.click()](https://playwright.nodejs.cn/docs/api/class-locator#locator-click) | 是 | 是 | 是 | 是 | - |

| [locator.dblclick()](https://playwright.nodejs.cn/docs/api/class-locator#locator-dblclick) | 是 | 是 | 是 | 是 | - |

| [locator.setChecked()](https://playwright.nodejs.cn/docs/api/class-locator#locator-set-checked) | 是 | 是 | 是 | 是 | - |

| [locator.tap()](https://playwright.nodejs.cn/docs/api/class-locator#locator-tap) | 是 | 是 | 是 | 是 | - |

| [locator.uncheck()](https://playwright.nodejs.cn/docs/api/class-locator#locator-uncheck) | 是 | 是 | 是 | 是 | - |

| [locator.hover()](https://playwright.nodejs.cn/docs/api/class-locator#locator-hover) | 是 | 是 | 是 | - | - |

| [locator.dragTo()](https://playwright.nodejs.cn/docs/api/class-locator#locator-drag-to) | 是 | 是 | 是 | - | - |

| [locator.screenshot()](https://playwright.nodejs.cn/docs/api/class-locator#locator-screenshot) | 是 | 是 | - | - | - |

| [locator.fill()](https://playwright.nodejs.cn/docs/api/class-locator#locator-fill) | 是 | - | - | 是 | 是 |

| [locator.clear()](https://playwright.nodejs.cn/docs/api/class-locator#locator-clear) | 是 | - | - | 是 | 是 |

| [locator.selectOption()](https://playwright.nodejs.cn/docs/api/class-locator#locator-select-option) | 是 | - | - | 是 | - |

| [locator.selectText()](https://playwright.nodejs.cn/docs/api/class-locator#locator-select-text) | 是 | - | - | - | - |

| [locator.scrollIntoViewIfNeeded()](https://playwright.nodejs.cn/docs/api/class-locator#locator-scroll-into-view-if-needed) | - | 是 | - | - | - |

| [locator.blur()](https://playwright.nodejs.cn/docs/api/class-locator#locator-blur) | - | - | - | - | - |

| [locator.dispatchEvent()](https://playwright.nodejs.cn/docs/api/class-locator#locator-dispatch-event) | - | - | - | - | - |

| [locator.focus()](https://playwright.nodejs.cn/docs/api/class-locator#locator-focus) | - | - | - | - | - |

| [locator.press()](https://playwright.nodejs.cn/docs/api/class-locator#locator-press) | - | - | - | - | - |

| [locator.pressSequentially()](https://playwright.nodejs.cn/docs/api/class-locator#locator-press-sequentially) | - | - | - | - | - |

| [locator.setInputFiles()](https://playwright.nodejs.cn/docs/api/class-locator#locator-set-input-files) | - | - | - | - | - |

## 强制行动

🌐 Forcing actions

某些操作，例如 [locator.click()](https://playwright.nodejs.cn/docs/api/class-locator#locator-click)，支持 `force` 选项，用于禁用非必要的可操作性检查，例如向 [locator.click()](https://playwright.nodejs.cn/docs/api/class-locator#locator-click) 方法传递真值 `force` 将不会检查目标元素是否真正接收到点击事件。

🌐 Some actions like [locator.click()](https://playwright.nodejs.cn/docs/api/class-locator#locator-click) support `force` option that disables non-essential actionability checks, for example passing truthy `force` to [locator.click()](https://playwright.nodejs.cn/docs/api/class-locator#locator-click) method will not check that the target element actually receives click events.

## 断言

🌐 Assertions

Playwright 包括自动重试断言，通过等待直到满足条件来消除不稳定，类似于操作之前的自动等待。

🌐 Playwright includes auto-retrying assertions that remove flakiness by waiting until the condition is met, similarly to auto-waiting before actions.

| 断言 | 描述 |

| :- | :- |

| [expect(locator).toBeAttached()](https://playwright.nodejs.cn/docs/api/class-locatorassertions#locator-assertions-to-be-attached) | 元素已附加 |

| [expect(locator).toBeChecked()](https://playwright.nodejs.cn/docs/api/class-locatorassertions#locator-assertions-to-be-checked) | 复选框已被选中 |

| [expect(locator).toBeDisabled()](https://playwright.nodejs.cn/docs/api/class-locatorassertions#locator-assertions-to-be-disabled) | 元素被禁用 |

| [expect(locator).toBeEditable()](https://playwright.nodejs.cn/docs/api/class-locatorassertions#locator-assertions-to-be-editable) | 元素可编辑 |

| [expect(locator).toBeEmpty()](https://playwright.nodejs.cn/docs/api/class-locatorassertions#locator-assertions-to-be-empty) | 容器为空 |

| [expect(locator).toBeEnabled()](https://playwright.nodejs.cn/docs/api/class-locatorassertions#locator-assertions-to-be-enabled) | 元素已启用 |

| [expect(locator).toBeFocused()](https://playwright.nodejs.cn/docs/api/class-locatorassertions#locator-assertions-to-be-focused) | 元素被聚焦 |

| [expect(locator).toBeHidden()](https://playwright.nodejs.cn/docs/api/class-locatorassertions#locator-assertions-to-be-hidden) | 元素不可见 |

| [expect(locator).toBeInViewport()](https://playwright.nodejs.cn/docs/api/class-locatorassertions#locator-assertions-to-be-in-viewport) | 元素与视口相交 |

| [expect(locator).toBeVisible()](https://playwright.nodejs.cn/docs/api/class-locatorassertions#locator-assertions-to-be-visible) | 元素可见 |

| [expect(locator).toContainText()](https://playwright.nodejs.cn/docs/api/class-locatorassertions#locator-assertions-to-contain-text) | 元素包含文本 |

| [expect(locator).toHaveAttribute()](https://playwright.nodejs.cn/docs/api/class-locatorassertions#locator-assertions-to-have-attribute) | 元素具有 DOM 属性 |

| [expect(locator).toHaveClass()](https://playwright.nodejs.cn/docs/api/class-locatorassertions#locator-assertions-to-have-class) | 元素具有类属性 |

| [expect(locator).toHaveCount()](https://playwright.nodejs.cn/docs/api/class-locatorassertions#locator-assertions-to-have-count) | 列表具有确切数量的子元素 |

| [expect(locator).toHaveCSS()](https://playwright.nodejs.cn/docs/api/class-locatorassertions#locator-assertions-to-have-css) | 元素具有 CSS 属性 |

| [expect(locator).toHaveId()](https://playwright.nodejs.cn/docs/api/class-locatorassertions#locator-assertions-to-have-id) | 元素有一个 ID |

| [expect(locator).toHaveJSProperty()](https://playwright.nodejs.cn/docs/api/class-locatorassertions#locator-assertions-to-have-js-property) | 元素拥有一个 JavaScript 属性 |

| [expect(locator).toHaveText()](https://playwright.nodejs.cn/docs/api/class-locatorassertions#locator-assertions-to-have-text) | 元素匹配文本 |

| [expect(locator).toHaveValue()](https://playwright.nodejs.cn/docs/api/class-locatorassertions#locator-assertions-to-have-value) | 输入框有一个值 |

| [expect(locator).toHaveValues()](https://playwright.nodejs.cn/docs/api/class-locatorassertions#locator-assertions-to-have-values) | 选择框已选择选项 |

| [expect(page).toHaveTitle()](https://playwright.nodejs.cn/docs/api/class-pageassertions#page-assertions-to-have-title) | 页面有标题 |

| [expect(page).toHaveURL()](https://playwright.nodejs.cn/docs/api/class-pageassertions#page-assertions-to-have-url) | 页面具有 URL |

| [expect(response).toBeOK()](https://playwright.nodejs.cn/docs/api/class-apiresponseassertions#api-response-assertions-to-be-ok) | 响应状态为OK |

在[断言指南](https://playwright.nodejs.cn/docs/test-assertions)中了解更多。

🌐 Learn more in the [assertions guide](https://playwright.nodejs.cn/docs/test-assertions).

## 可见的

🌐 Visible

当元素具有非空的边界框且没有 `visibility:hidden` 计算样式时，认为该元素是可见的。

🌐 Element is considered visible when it has non-empty bounding box and does not have `visibility:hidden` computed style.

请注意，根据这个定义：

🌐 Note that according to this definition:

*   零尺寸的元素**不**被认为是可见的。
*   带有 `display:none` 的元素**不**被认为是可见的。
*   带有 `opacity:0` 的元素被认为是可见的。

## 稳定的

🌐 Stable

当元素在至少两个连续的动画帧中保持相同的边界框时，该元素被认为是稳定的。

🌐 Element is considered stable when it has maintained the same bounding box for at least two consecutive animation frames.

## 启用

🌐 Enabled

当元素**没有被禁用**时，认为它是可用的。

🌐 Element is considered enabled when it is **not disabled**.

当元素**被禁用**时：

🌐 Element is **disabled** when:

*   它是一个具有 `[disabled]` 属性的 `<button>`、`<select>`、`<input>`、`<textarea>`、`<option>` 或 `<optgroup>`；
*   它是一个 `<button>`、`<select>`、`<input>`、`<textarea>`、`<option>` 或 `<optgroup>`，是 `<fieldset>` 的一部分，并具有 `[disabled]` 属性；
*   它是具有 `[aria-disabled=true]` 属性的元素的子孙。

## 可编辑

🌐 Editable

当元素是[启用]且**不是只读**时，认为它是可编辑的。

🌐 Element is considered editable when it is [enabled](http://playwright.nodejs.cn/docs/actionability#enabled "Enabled") and is **not readonly**.

当元素为**只读**时：

🌐 Element is **readonly** when:

*   它是一个具有 `[readonly]` 属性的 `<select>`、`<input>` 或 `<textarea>`;
*   它具有一个 `[aria-readonly=true]` 属性和一个支持它的 aria 角色 [supports it](https://w3c.github.io/aria/#aria-readonly)。

## 接收事件

🌐 Receives Events

当元素在操作点上成为指针事件的命中目标时，该元素被认为接收指针事件。例如，当在点 `(10;10)` 点击时，Playwright 会检查是否有其他元素（通常是覆盖层）会在 `(10;10)` 捕获该点击。

🌐 Element is considered receiving pointer events when it is the hit target of the pointer event at the action point. For example, when clicking at the point `(10;10)`, Playwright checks whether some other element (usually an overlay) will instead capture the click at `(10;10)`.

例如，考虑一种场景，在该场景中，无论 [locator.click()](https://playwright.nodejs.cn/docs/api/class-locator#locator-click) 调用何时发生，Playwright 都会点击 `Sign Up` 按钮：

🌐 For example, consider a scenario where Playwright will click `Sign Up` button regardless of when the [locator.click()](https://playwright.nodejs.cn/docs/api/class-locator#locator-click) call was made:

*   页面正在检查用户名是否唯一，并且 `Sign Up` 按钮被禁用；
*   在与服务器确认后，已禁用的 `Sign Up` 按钮被替换为另一个已启用的按钮。
