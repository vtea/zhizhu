---
title: 行动
source_url: https://playwright.nodejs.cn/docs/input
fetched_at: 2026-04-29T02:57:28.664Z
---

# 行动

## 介绍

🌐 Introduction

Playwright 可以与 HTML 输入元素进行交互，例如文本输入、复选框、单选按钮、选择选项、鼠标单击、键入字符、按键和快捷键以及上传文件和焦点元素。

🌐 Playwright can interact with HTML Input elements such as text inputs, checkboxes, radio buttons, select options, mouse clicks, type characters, keys and shortcuts as well as upload files and focus elements.

## 文本输入

🌐 Text input

使用 [locator.fill()](https://playwright.nodejs.cn/docs/api/class-locator#locator-fill) 是填写表单字段的最简单方法。它会聚焦元素并触发包含输入文本的 `input` 事件。它适用于 `<input>`、`<textarea>` 和 `[contenteditable]` 元素。

🌐 Using [locator.fill()](https://playwright.nodejs.cn/docs/api/class-locator#locator-fill) is the easiest way to fill out the form fields. It focuses the element and triggers an `input` event with the entered text. It works for `<input>`, `<textarea>` and `[contenteditable]` elements.

```ts
// Text inputawait page.getByRole('textbox').fill('Peter');
// Date inputawait page.getByLabel('Birth date').fill('2020-02-02');
// Time inputawait page.getByLabel('Appointment time').fill('13:15');
// Local datetime inputawait page.getByLabel('Local time').fill('2020-03-02T05:15');
```

## 复选框和单选按钮

🌐 Checkboxes and radio buttons

使用 [locator.setChecked()](https://playwright.nodejs.cn/docs/api/class-locator#locator-set-checked) 是勾选和取消勾选复选框或单选按钮的最简单方法。此方法可用于 `input[type=checkbox]`、`input[type=radio]` 和 `[role=checkbox]` 元素。

🌐 Using [locator.setChecked()](https://playwright.nodejs.cn/docs/api/class-locator#locator-set-checked) is the easiest way to check and uncheck a checkbox or a radio button. This method can be used with `input[type=checkbox]`, `input[type=radio]` and `[role=checkbox]` elements.

```ts
// Check the checkboxawait page.getByLabel('I agree to the terms above').check();
// Assert the checked stateexpect(page.getByLabel('Subscribe to newsletter')).toBeChecked();
// Select the radio buttonawait page.getByLabel('XL').check();
```

## 选择选项

🌐 Select options

使用 [locator.selectOption()](https://playwright.nodejs.cn/docs/api/class-locator#locator-select-option) 在 `<select>` 元素中选择一个或多个选项。你可以指定要选择的选项 `value` 或 `label`。可以选择多个选项。

🌐 Selects one or multiple options in the `<select>` element with [locator.selectOption()](https://playwright.nodejs.cn/docs/api/class-locator#locator-select-option). You can specify option `value`, or `label` to select. Multiple options can be selected.

```ts
// Single selection matching the value or labelawait page.getByLabel('Choose a color').selectOption('blue');
// Single selection matching the labelawait page.getByLabel('Choose a color').selectOption({ label: 'Blue' });
// Multiple selected itemsawait page.getByLabel('Choose multiple colors').selectOption(['red', 'green', 'blue']);
```

## 鼠标点击

🌐 Mouse click

执行简单的人工点击。

🌐 Performs a simple human click.

```json
// Generic clickawait page.getByRole('button').click();// Double clickawait page.getByText('Item').dblclick();// Right clickawait page.getByText('Item').click({ button: 'right' });// Shift + clickawait page.getByText('Item').click({ modifiers: ['Shift'] });// Ctrl + click on Windows and Linux// Meta + click on macOSawait page.getByText('Item').click({ modifiers: ['ControlOrMeta'] });// Hover over elementawait page.getByText('Item').hover();// Click the top left cornerawait page.getByText('Item').click({ position: { x: 0, y: 0 } });
```

在底层，这个方法和其他与指针相关的方法：

🌐 Under the hood, this and other pointer-related methods:

*   等待具有给定选择器的元素出现在 DOM 中
*   等待它显示出来，即不为空，没有 `display:none`，没有 `visibility:hidden`
*   等待它停止移动，例如，直到 css 转换完成
*   将元素滚动到视图中
*   等待它在操作点接收指针事件，例如，等待元素变得不被其他元素遮挡
*   如果在上述任何检查期间该元素被分离，则重试

#### 强制点击

🌐 Forcing the click

有时，应用会使用非平凡的逻辑，当鼠标悬停在某个元素上时，会有另一个元素覆盖它并拦截点击。这种行为无法与某个元素被覆盖并点击被分发到其他地方的错误区分开。如果你知道这种情况正在发生，你可以绕过[actionability](https://playwright.nodejs.cn/docs/actionability)检查并强制点击：

🌐 Sometimes, apps use non-trivial logic where hovering the element overlays it with another element that intercepts the click. This behavior is indistinguishable from a bug where element gets covered and the click is dispatched elsewhere. If you know this is taking place, you can bypass the [actionability](https://playwright.nodejs.cn/docs/actionability) checks and force the click:

```ts
await page.getByRole('button').click({ force: true });
```

#### 程序化点击

🌐 Programmatic click

如果你不想在真实条件下测试你的应用，而只是想以任何可能的方式模拟点击，你可以通过在元素上使用 [locator.dispatchEvent()](https://playwright.nodejs.cn/docs/api/class-locator#locator-dispatch-event) 触发点击事件，从而触发 [`HTMLElement.click()`](https://web.nodejs.cn/en-US/docs/Web/API/HTMLElement/click) 行为：

🌐 If you are not interested in testing your app under the real conditions and want to simulate the click by any means possible, you can trigger the [`HTMLElement.click()`](https://web.nodejs.cn/en-US/docs/Web/API/HTMLElement/click) behavior via simply dispatching a click event on the element with [locator.dispatchEvent()](https://playwright.nodejs.cn/docs/api/class-locator#locator-dispatch-event):

```ts
await page.getByRole('button').dispatchEvent('click');
```

## 输入字符

🌐 Type characters

caution

大多数情况下，你应该使用 [locator.fill()](https://playwright.nodejs.cn/docs/api/class-locator#locator-fill) 输入文本。请参见上面的 [文本输入](http://playwright.nodejs.cn/docs/input#text-input) 部分。只有在页面上有特殊键盘处理的情况下，你才需要手动输入字符。

🌐 Most of the time, you should input text with [locator.fill()](https://playwright.nodejs.cn/docs/api/class-locator#locator-fill). See the [Text input](http://playwright.nodejs.cn/docs/input#text-input) section above. You only need to type characters if there is special keyboard handling on the page.

像真实用户使用键盘一样，将字符逐个输入到字段中，使用 [locator.pressSequentially()](https://playwright.nodejs.cn/docs/api/class-locator#locator-press-sequentially)。

🌐 Type into the field character by character, as if it was a user with a real keyboard with [locator.pressSequentially()](https://playwright.nodejs.cn/docs/api/class-locator#locator-press-sequentially).

```ts
// Press keys one by oneawait page.locator('#area').pressSequentially('Hello World!');
```

此方法将触发所有必要的键盘事件，包括所有的 `keydown`、`keyup`、`keypress` 事件。你甚至可以在按键之间指定可选的 `delay`，以模拟真实的用户行为。

🌐 This method will emit all the necessary keyboard events, with all the `keydown`, `keyup`, `keypress` events in place. You can even specify the optional `delay` between the key presses to simulate real user behavior.

## 按键和快捷键

🌐 Keys and shortcuts

```ts
// Hit Enterawait page.getByText('Submit').press('Enter');
// Dispatch Control+Rightawait page.getByRole('textbox').press('Control+ArrowRight');
// Press $ sign on keyboardawait page.getByRole('textbox').press('$');
```

[locator.press()](https://playwright.nodejs.cn/docs/api/class-locator#locator-press) 方法会聚焦所选元素并产生单个按键。它接受在键盘事件的 [keyboardEvent.key](https://web.nodejs.cn/en-US/docs/Web/API/KeyboardEvent/key) 属性中发出的逻辑键名：

🌐 The [locator.press()](https://playwright.nodejs.cn/docs/api/class-locator#locator-press) method focuses the selected element and produces a single keystroke. It accepts the logical key names that are emitted in the [keyboardEvent.key](https://web.nodejs.cn/en-US/docs/Web/API/KeyboardEvent/key) property of the keyboard events:

```
Backquote, Minus, Equal, Backslash, Backspace, Tab, Delete, Escape,ArrowDown, End, Enter, Home, Insert, PageDown, PageUp, ArrowRight,ArrowUp, F1 - F12, Digit0 - Digit9, KeyA - KeyZ, etc.
```

*   你也可以选择指定一个想要生成的单个字符，例如 `"a"` 或 `"#"`。
*   以下修改快捷方式也受支持：`Shift, Control, Alt, Meta`。

简单版本会生成一个单独的字符。这个字符区分大小写，所以 `"a"` 和 `"A"` 会产生不同的结果。

🌐 Simple version produces a single character. This character is case-sensitive, so `"a"` and `"A"` will produce different results.

```ts
// <input id=name>await page.locator('#name').press('Shift+A');
// <input id=name>await page.locator('#name').press('Shift+ArrowLeft');
```

同样支持像 `"Control+o"` 或 `"Control+Shift+T"` 这样的快捷键。当与修饰键一起指定时，会在按下后续按键的同时按住修饰键。

🌐 Shortcuts such as `"Control+o"` or `"Control+Shift+T"` are supported as well. When specified with the modifier, modifier is pressed and being held while the subsequent key is being pressed.

请注意，你仍然需要在 `Shift-A` 中指定大写的 `A` 才能生成大写字符。`Shift-a` 会生成小写字符，就好像你已经切换了 `CapsLock` 一样。

🌐 Note that you still need to specify the capital `A` in `Shift-A` to produce the capital character. `Shift-a` produces a lower-case one as if you had the `CapsLock` toggled.

## 上传文件

🌐 Upload files

你可以使用 [locator.setInputFiles()](https://playwright.nodejs.cn/docs/api/class-locator#locator-set-input-files) 方法选择要上传的输入文件。它的第一个参数应指向类型为 `"file"` 的 [输入元素](https://web.nodejs.cn/en-US/docs/Web/HTML/Element/input)。可以在数组中传入多个文件。如果某些文件路径是相对路径，它们将相对于当前工作目录进行解析。空数组会清除已选择的文件。

🌐 You can select input files for upload using the [locator.setInputFiles()](https://playwright.nodejs.cn/docs/api/class-locator#locator-set-input-files) method. It expects first argument to point to an [input element](https://web.nodejs.cn/en-US/docs/Web/HTML/Element/input) with the type `"file"`. Multiple files can be passed in the array. If some of the file paths are relative, they are resolved relative to the current working directory. Empty array clears the selected files.

```ts
// Select one fileawait page.getByLabel('Upload file').setInputFiles(path.join(__dirname, 'myfile.pdf'));
// Select multiple filesawait page.getByLabel('Upload files').setInputFiles([  path.join(__dirname, 'file1.txt'),  path.join(__dirname, 'file2.txt'),]);
// Select a directoryawait page.getByLabel('Upload directory').setInputFiles(path.join(__dirname, 'mydir'));
// Remove all the selected filesawait page.getByLabel('Upload file').setInputFiles([]);
// Upload buffer from memoryawait page.getByLabel('Upload file').setInputFiles({
  name: 'file.txt',  mimeType: 'text/plain',  buffer: Buffer.from('this is test')});
```

如果你手头没有输入元素（它是动态创建的），你可以处理 [page.on('filechooser')](https://playwright.nodejs.cn/docs/api/class-page#page-event-file-chooser) 事件，或者在执行操作时使用相应的等待方法：

🌐 If you don't have input element in hand (it is created dynamically), you can handle the [page.on('filechooser')](https://playwright.nodejs.cn/docs/api/class-page#page-event-file-chooser) event or use a corresponding waiting method upon your action:

```ts
// Start waiting for file chooser before clicking. Note no await.const fileChooserPromise = page.waitForEvent('filechooser');
await page.getByLabel('Upload file').click();
const fileChooser = await fileChooserPromise;
await fileChooser.setFiles(path.join(__dirname, 'myfile.pdf'));
```

## 焦点元素

🌐 Focus element

对于处理焦点事件的动态页面，你可以使用 [locator.focus()](https://playwright.nodejs.cn/docs/api/class-locator#locator-focus) 来聚焦指定元素。

🌐 For the dynamic pages that handle focus events, you can focus the given element with [locator.focus()](https://playwright.nodejs.cn/docs/api/class-locator#locator-focus).

```ts
await page.getByLabel('Password').focus();
```

## 拖放

🌐 Drag and Drop

你可以使用 [locator.dragTo()](https://playwright.nodejs.cn/docs/api/class-locator#locator-drag-to) 执行拖放操作。此方法将：

🌐 You can perform drag&drop operation with [locator.dragTo()](https://playwright.nodejs.cn/docs/api/class-locator#locator-drag-to). This method will:

*   将鼠标悬停在要拖动的元素上。
*   按鼠标左键。
*   将鼠标移动到将接收掉落的元素。
*   释放鼠标左键。

```ts
await page.locator('#item-to-be-dragged').dragTo(page.locator('#item-to-drop-at'));
```

### 手动拖动

🌐 Dragging manually

如果你想精确控制拖拽操作，可以使用更底层的方法，如 [locator.hover()](https://playwright.nodejs.cn/docs/api/class-locator#locator-hover)、[mouse.down()](https://playwright.nodejs.cn/docs/api/class-mouse#mouse-down)、[mouse.move()](https://playwright.nodejs.cn/docs/api/class-mouse#mouse-move) 和 [mouse.up()](https://playwright.nodejs.cn/docs/api/class-mouse#mouse-up)。

🌐 If you want precise control over the drag operation, use lower-level methods like [locator.hover()](https://playwright.nodejs.cn/docs/api/class-locator#locator-hover), [mouse.down()](https://playwright.nodejs.cn/docs/api/class-mouse#mouse-down), [mouse.move()](https://playwright.nodejs.cn/docs/api/class-mouse#mouse-move) and [mouse.up()](https://playwright.nodejs.cn/docs/api/class-mouse#mouse-up).

```ts
await page.locator('#item-to-be-dragged').hover();
await page.mouse.down();
await page.locator('#item-to-drop-at').hover();
await page.mouse.up();
```

note

如果你的页面依赖于 `dragover` 事件的触发，你至少需要两次鼠标移动才能在所有浏览器中触发它。为了可靠地发出第二次鼠标移动，请重复使用你的 [mouse.move()](https://playwright.nodejs.cn/docs/api/class-mouse#mouse-move) 或 [locator.hover()](https://playwright.nodejs.cn/docs/api/class-locator#locator-hover) 两次。操作顺序如下：悬停拖动元素，按下鼠标，悬停放置元素，再次悬停放置元素，松开鼠标。

🌐 Scrolling

大多数情况下，Playwright 会在执行任何操作之前自动为你滚动。因此，你不需要显式地滚动。

🌐 Most of the time, Playwright will automatically scroll for you before doing any actions. Therefore, you do not need to scroll explicitly.

```ts
// Scrolls automatically so that button is visibleawait page.getByRole('button').click();
```

然而，在极少数情况下，你可能需要手动滚动。例如，你可能想强制“无限列表”加载更多元素，或者将页面定位到特定的屏幕截图位置。在这种情况下，最可靠的方法是找到你希望显示在底部的元素，并将其滚动到可见位置。

🌐 However, in rare cases you might need to manually scroll. For example, you might want to force an "infinite list" to load more elements, or position the page for a specific screenshot. In such a case, the most reliable way is to find an element that you want to make visible at the bottom, and scroll it into view.

```ts
// Scroll the footer into view, forcing an "infinite list" to load more contentawait page.getByText('Footer text').scrollIntoViewIfNeeded();
```

如果你想更精确地控制滚动，可以使用 [mouse.wheel()](https://playwright.nodejs.cn/docs/api/class-mouse#mouse-wheel) 或 [locator.evaluate()](https://playwright.nodejs.cn/docs/api/class-locator#locator-evaluate)：

🌐 If you would like to control the scrolling more precisely, use [mouse.wheel()](https://playwright.nodejs.cn/docs/api/class-mouse#mouse-wheel) or [locator.evaluate()](https://playwright.nodejs.cn/docs/api/class-locator#locator-evaluate):

```ts
// Position the mouse and scroll with the mouse wheelawait page.getByTestId('scrolling-container').hover();
await page.mouse.wheel(0, 10);
// Alternatively, programmatically scroll a specific elementawait page.getByTestId('scrolling-container').evaluate(e => e.scrollTop += 100);
```
