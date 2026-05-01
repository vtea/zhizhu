---
title: 快照测试
source_url: https://playwright.nodejs.cn/docs/aria-snapshots
fetched_at: 2026-04-29T02:57:28.664Z
---

# 快照测试

## 概述

🌐 Overview

使用 Playwright 的快照测试，你可以根据预定义的快照模板断言页面的可访问性树。

🌐 With Playwright's Snapshot testing you can assert the accessibility tree of a page against a predefined snapshot template.

```ts
await page.goto('https://playwright.nodejs.cn/');
await expect(page.getByRole('banner')).toMatchAriaSnapshot(`  - banner:    - heading /Playwright enables reliable end-to-end/ [level=1]    - link "Get started"    - link "Star microsoft/playwright on GitHub"    - link /[\\d]+k\\+ stargazers on GitHub/`);
```

## 断言测试与快照测试

🌐 Assertion testing vs Snapshot testing

快照测试和断言测试在测试自动化中有不同的用途：

🌐 Snapshot testing and assertion testing serve different purposes in test automation:

### 断言测试

🌐 Assertion testing

断言测试是一种针对性的方式，你可以对元素或组件的特定值或条件进行断言。例如，在 Playwright 中，[expect(locator).toHaveText()](https://playwright.nodejs.cn/docs/api/class-locatorassertions#locator-assertions-to-have-text) 用于验证一个元素包含预期的文本，而 [expect(locator).toHaveValue()](https://playwright.nodejs.cn/docs/api/class-locatorassertions#locator-assertions-to-have-value) 用于确认输入字段具有预期的值。断言测试是具体的，通常用于将元素或属性的当前状态与预定义的期望状态进行比较。它们适用于可预测的单值检查，但在测试更广泛的结构或变化时范围有限。

🌐 Assertion testing is a targeted approach where you assert specific values or conditions about elements or components. For instance, with Playwright, [expect(locator).toHaveText()](https://playwright.nodejs.cn/docs/api/class-locatorassertions#locator-assertions-to-have-text) verifies that an element contains the expected text, and [expect(locator).toHaveValue()](https://playwright.nodejs.cn/docs/api/class-locatorassertions#locator-assertions-to-have-value) confirms that an input field has the expected value. Assertion tests are specific and generally check the current state of an element or property against an expected, predefined state. They work well for predictable, single-value checks but are limited in scope when testing the broader structure or variations.

**优点**

*   **清晰度**：测试的意图明确且易于理解。
*   **特异性**：测试集中于功能的特定方面，使其对无关的变化更具稳健性。
*   **调试**：失败会提供有针对性的反馈，直接指出问题所在。

**缺点**

*   **复杂输出的详细说明**：为复杂的数据结构或大型输出编写断言可能既繁琐又容易出错。
*   **维护开销**：随着代码的发展，手动更新断言可能非常耗时。

### 快照测试

🌐 Snapshot testing

快照测试会捕捉元素、组件或数据在特定时刻的“快照”或整体状态表示，并将其保存以供日后比较。在重新运行测试时，当前状态会与快照进行对比，如果存在差异，则测试失败。这种方法对于复杂或动态结构尤其有用，因为手动断言每个细节将耗时过长。快照测试比断言测试更广泛、更整体，可以让你跟踪随时间发生的更复杂变化。

🌐 Snapshot testing captures a “snapshot” or representation of the entire state of an element, component, or data at a given moment, which is then saved for future comparisons. When re-running tests, the current state is compared to the snapshot, and if there are differences, the test fails. This approach is especially useful for complex or dynamic structures, where manually asserting each detail would be too time-consuming. Snapshot testing is broader and more holistic than assertion testing, allowing you to track more complex changes over time.

**优点**

*   **简化复杂输出**：例如，使用传统断言测试 UI 组件的渲染输出可能很繁琐。快照可以捕获整个输出，便于比较。
*   **快速反馈循环**：开发者可以轻松发现输出中的非预期变化。
*   **鼓励一致性**：随着代码的发展，帮助保持输出的一致性。

**缺点**

*   **过度依赖**：在没有完全理解快照变化的情况下接受它们可能很诱人，但这可能会隐藏错误。
*   **粒度**：当出现差异时，大型快照可能难以解读，尤其是当微小的更改影响到输出的大部分内容时。
*   **适用性**：不适合输出频繁或不可预测变化的高度动态内容。

### 何时使用

🌐 When to use

*   **快照测试** 适用于： 
    *   整个页面和组件的 UI 测试。
    *   对复杂 UI 组件进行广泛的结构检查。
    *   对很少改变结构的输出进行回归测试。

*   **断言测试** 最适合用于： 
    *   核心逻辑验证。
    *   计算值测试。
    *   需要精确条件的细粒度测试。

通过结合快照测试进行广泛的结构检查和断言测试进行特定功能，你可以实现全面的测试策略。

🌐 By combining snapshot testing for broad, structural checks and assertion testing for specific functionality, you can achieve a well-rounded testing strategy.

## Aria 快照

🌐 Aria snapshots

在 Playwright 中，aria 快照提供页面可访问性树的 YAML 表示。这些快照可以被存储并在之后进行比较，以验证页面结构是否保持一致或符合已定义的期望。

🌐 In Playwright, aria snapshots provide a YAML representation of the accessibility tree of a page. These snapshots can be stored and compared later to verify if the page structure remains consistent or meets defined expectations.

YAML 格式描述了页面上可访问元素的层级结构，详细说明了 **角色**、**属性**、**值** 和 **文本内容**。结构遵循类似树状的语法，每个节点代表一个可访问元素，缩进表示嵌套元素。

🌐 The YAML format describes the hierarchical structure of accessible elements on the page, detailing **roles**, **attributes**, **values**, and **text content**. The structure follows a tree-like syntax, where each node represents an accessible element, and indentation indicates nested elements.

树中的每个可访问元素都表示为一个 YAML 节点：

🌐 Each accessible element in the tree is represented as a YAML node:

```
- role "name" [attribute=value]
```

*   **role**：指定元素的 ARIA 或 HTML 角色（例如，`heading`、`list`、`listitem`、`button`）。
*   **"name"**：元素的可访问名称。引号字符串表示确切值，`/patterns/` 用于正则表达式。
*   **[attribute=value]**：用方括号表示的属性和值，代表特定的 ARIA 属性，例如 `checked`、`disabled`、`expanded`、`level`、`pressed` 或 `selected`。

这些值是从 ARIA 属性中得出的，或基于 HTML 语义计算得出。要检查页面的可访问性树结构，请使用 [Chrome 开发者工具的可访问性标签](https://developer.chrome.com/docs/devtools/accessibility/reference#tab)。

🌐 These values are derived from ARIA attributes or calculated based on HTML semantics. To inspect the accessibility tree structure of a page, use the [Chrome DevTools Accessibility Tab](https://developer.chrome.com/docs/devtools/accessibility/reference#tab).

## 快照匹配

🌐 Snapshot matching

Playwright 中的 [expect(locator).toMatchAriaSnapshot()](https://playwright.nodejs.cn/docs/api/class-locatorassertions#locator-assertions-to-match-aria-snapshot) 断言方法将定位器范围的可访问性结构与预定义的 ARIA 快照模板进行比较，有助于根据测试要求验证页面状态。

🌐 The [expect(locator).toMatchAriaSnapshot()](https://playwright.nodejs.cn/docs/api/class-locatorassertions#locator-assertions-to-match-aria-snapshot) assertion method in Playwright compares the accessible structure of the locator scope with a predefined aria snapshot template, helping validate the page's state against testing requirements.

对于以下 DOM：

🌐 For the following DOM:

`<h1>title</h1>`

你可以使用以下快照模板进行匹配：

🌐 You can match it using the following snapshot template:

```ts
await expect(page.locator('body')).toMatchAriaSnapshot(`  - heading "title"`);
```

匹配时，会将快照模板与页面的当前可访问性树进行比较：

🌐 When matching, the snapshot template is compared to the current accessibility tree of the page:

*   如果树状结构与模板匹配，测试就通过；否则，测试失败，表示预期的可访问性状态与实际状态不匹配。
*   比较区分大小写并折叠空格，因此会忽略缩进和换行符。
*   比较区分顺序，这意味着快照模板中元素的顺序必须与页面可访问性树中的顺序匹配。

### 部分匹配

🌐 Partial matching

你可以通过省略属性或可访问名称来对节点进行部分匹配，从而验证可访问性树的特定部分，而无需精确匹配。这种灵活性对于动态或无关的属性非常有用。

🌐 You can perform partial matches on nodes by omitting attributes or accessible names, enabling verification of specific parts of the accessibility tree without requiring exact matches. This flexibility is helpful for dynamic or irrelevant attributes.

```
<button>Submit</button>
```

_aria 快照_

`- button`

在此示例中，按钮的角色匹配成功，但未指定可访问名称（“提交”），这使得测试可以通过，而不管按钮的标签是什么。

🌐 In this example, the button role is matched, but the accessible name ("Submit") is not specified, allowing the test to pass regardless of the button's label.

* * *

对于具有像 `checked` 或 `disabled` 这样的 ARIA 属性的元素，省略这些属性可以实现部分匹配，仅关注角色和层级。

🌐 For elements with ARIA attributes like `checked` or `disabled`, omitting these attributes allows partial matching, focusing solely on role and hierarchy.

```
<input type="checkbox" checked>
```

_aria 快照用于部分匹配_

`- checkbox`

在这个部分匹配中，`checked` 属性被忽略，因此测试将不受复选框状态的影响而通过。

🌐 In this partial match, the `checked` attribute is ignored, so the test will pass regardless of the checkbox state.

* * *

同样，你可以通过省略特定列表项或嵌套元素来部分匹配列表或组中的子项。

🌐 Similarly, you can partially match children in lists or groups by omitting specific list items or nested elements.

```
<ul>  <li>Feature A</li>  <li>Feature B</li>  <li>Feature C</li></ul>
```

_aria 快照用于部分匹配_

```
- list  - listitem: Feature B
```

部分匹配让你可以创建灵活的快照测试，以验证基本页面结构，而无需强制执行特定内容或属性。

🌐 Partial matches let you create flexible snapshot tests that verify essential page structure without enforcing specific content or attributes.

### 严格匹配

🌐 Strict matching

默认情况下，将匹配包含子项子集的模板：

🌐 By default, a template containing the subset of children will be matched:

```
<ul>  <li>Feature A</li>  <li>Feature B</li>  <li>Feature C</li></ul>
```

_aria 快照用于部分匹配_

```
- list  - listitem: Feature B
```

`/children` 属性可用于控制子元素的匹配方式：

🌐 The `/children` property can be used to control how child elements are matched:

*   `contain`（默认）：如果所有指定的子项按顺序存在，则匹配
*   `equal`：如果子元素按顺序与指定列表完全匹配，则匹配
*   `deep-equal`：如果子元素按顺序与指定列表完全匹配，包括嵌套子元素，则匹配

```
<ul>  <li>Feature A</li>  <li>Feature B</li>  <li>Feature C</li></ul>
```

_aria 快照将失败，因为模板中没有功能 C_

```
- list  - /children: equal  - listitem: Feature A  - listitem: Feature B
```

### 使用正则表达式匹配

🌐 Matching with regular expressions

正则表达式允许针对包含动态或可变文本的元素进行灵活匹配。可访问名称和文本可以支持正则表达式模式。

🌐 Regular expressions allow flexible matching for elements with dynamic or variable text. Accessible names and text can support regex patterns.

`<h1>Issues 12</h1>`

_使用正则表达式的aria快照_

```
- heading /Issues \d+/
```

## 生成快照

🌐 Generating snapshots

在 Playwright 中创建 aria 快照有助于确保和维护应用的结构。你可以根据测试设置和工作流程以多种方式生成快照。

🌐 Creating aria snapshots in Playwright helps ensure and maintain your application's structure. You can generate snapshots in various ways depending on your testing setup and workflow.

### 使用 Playwright 代码生成器生成快照

🌐 Generating snapshots with the Playwright code generator

如果你正在使用 Playwright 的 [代码生成器](https://playwright.nodejs.cn/docs/codegen)，通过其交互式界面生成 aria 快照会更加简便：

🌐 If you're using Playwright's [Code Generator](https://playwright.nodejs.cn/docs/codegen), generating aria snapshots is streamlined with its interactive interface:

*   **“断言快照”操作**：在代码生成器中，你可以使用“断言快照”操作为选定的元素自动创建快照断言。这是一种在录制的测试流程中快速捕获 ARIA 快照的方法。
*   **“Aria 快照”选项卡**：代码生成器界面中的“Aria 快照”选项卡可直观显示所选定位器的 aria 快照，让你能够浏览、检查和验证元素的角色、属性以及可访问名称，从而帮助创建和审查快照。

### 使用 `@playwright/test` 和 `--update-snapshots` 标志更新快照

🌐 Updating snapshots with `@playwright/test` and the `--update-snapshots` flag

使用 Playwright 测试运行器（`@playwright/test`）时，你可以使用 `--update-snapshots` 标志自动更新快照，简称为 `-u`。

🌐 When using the Playwright test runner (`@playwright/test`), you can automatically update snapshots with the `--update-snapshots` flag, `-u` for short.

使用 `--update-snapshots` 标志运行测试将更新不匹配的快照。匹配的快照不会被更新。

🌐 Running tests with the `--update-snapshots` flag will update snapshots that did not match. Matching snapshots will not be updated.

```bash
npx playwright test --update-snapshots
```

在应用结构更改需要新的快照作为基准时，更新快照是有用的。请注意，Playwright 会等待测试运行器配置中指定的最大期望超时，以确保页面稳定后再进行快照。如果生成快照时测试触发超时，可能需要调整 `--timeout`。

🌐 Updating snapshots is useful when application structure changes require new snapshots as a baseline. Note that Playwright will wait for the maximum expect timeout specified in the test runner configuration to ensure the page is settled before taking the snapshot. It might be necessary to adjust the `--timeout` if the test hits the timeout while generating snapshots.

#### 用于快照生成的空模板

🌐 Empty template for snapshot generation

在断言中传递一个空字符串作为模板会即时生成快照：

🌐 Passing an empty string as the template in an assertion generates a snapshot on-the-fly:

```ts
await expect(locator).toMatchAriaSnapshot('');
```

请注意，Playwright 会等待测试运行器配置中指定的最大 expect 超时时间，以确保页面在截图前已稳定。如果在生成快照时测试达到超时，可能需要调整 `--timeout`。

🌐 Note that Playwright will wait for the maximum expect timeout specified in the test runner configuration to ensure the page is settled before taking the snapshot. It might be necessary to adjust the `--timeout` if the test hits the timeout while generating snapshots.

#### 快照补丁文件

🌐 Snapshot patch files

在更新快照时，Playwright 会创建捕获差异的补丁文件。这些补丁文件可以被审核、应用并提交到源代码管理，从而让团队能够跟踪结构变化，并确保更新符合应用的要求。

🌐 When updating snapshots, Playwright creates patch files that capture differences. These patch files can be reviewed, applied, and committed to source control, allowing teams to track structural changes over time and ensure updates are consistent with application requirements.

可以使用 `--update-source-method` 标志更改源代码更新的方式。可用的选项有几种：

🌐 The way source code is updated can be changed using the `--update-source-method` flag. There are several options available:

*   **“patch”**（默认）：生成一个统一差异文件，可以使用 `git apply` 应用于源代码。
*   **“三方合并”**：在你的源代码中生成合并冲突标记，让你可以选择是否接受更改。
*   **“覆盖”**：使用新的快照值覆盖源代码。

```bash
npx playwright test --update-snapshots --update-source-method=3way
```

#### 快照作为单独的文件

🌐 Snapshots as separate files

要将快照存储在单独的文件中，请使用带有 `name` 选项的 `toMatchAriaSnapshot` 方法，并指定 `.aria.yml` 文件扩展名。

🌐 To store your snapshots in a separate file, use the `toMatchAriaSnapshot` method with the `name` option, specifying a `.aria.yml` file extension.

```ts
await expect(page.getByRole('main')).toMatchAriaSnapshot({ name: 'main.aria.yml' });
```

默认情况下，测试文件 `example.spec.ts` 的快照会放置在 `example.spec.ts-snapshots` 目录中。由于快照在各个浏览器中应该是相同的，即使使用多个浏览器进行测试，也只会保存一份快照。如果你愿意，可以使用以下配置自定义 [快照路径模板](https://playwright.nodejs.cn/docs/api/class-testconfig#test-config-snapshot-path-template)：

🌐 By default, snapshots from a test file `example.spec.ts` are placed in the `example.spec.ts-snapshots` directory. As snapshots should be the same across browsers, only one snapshot is saved even if testing with multiple browsers. Should you wish, you can customize the [snapshot path template](https://playwright.nodejs.cn/docs/api/class-testconfig#test-config-snapshot-path-template) using the following configuration:

```json
export default defineConfig({  expect: {    toMatchAriaSnapshot: {      pathTemplate: '__snapshots__/{testFilePath}/{arg}{ext}',    },  },});
```

### 使用 `Locator.ariaSnapshot` 方法

🌐 Using the `Locator.ariaSnapshot` method

[locator.ariaSnapshot()](https://playwright.nodejs.cn/docs/api/class-locator#locator-aria-snapshot) 方法允许你以编程方式创建定位器范围内可访问元素的 YAML 表示，这在测试执行过程中动态生成快照时尤其有用。

🌐 The [locator.ariaSnapshot()](https://playwright.nodejs.cn/docs/api/class-locator#locator-aria-snapshot) method allows you to programmatically create a YAML representation of accessible elements within a locator's scope, especially helpful for generating snapshots dynamically during test execution.

**示例**:

```ts
const snapshot = await page.locator('body').ariaSnapshot();
console.log(snapshot);
```

此命令以 YAML 格式输出指定定位器范围内的 aria 快照，你可以根据需要验证或存储它。

🌐 This command outputs the aria snapshot within the specified locator's scope in YAML format, which you can validate or store as needed.

## 可访问性树示例

🌐 Accessibility tree examples

### 具有级别属性的标题

🌐 Headings with level attributes

标题可以包含一个 `level` 属性，用于指示其标题级别。

🌐 Headings can include a `level` attribute indicating their heading level.

```
<h1>Title</h1><h2>Subtitle</h2>
```

_aria 快照_

```
- heading "Title" [level=1]- heading "Subtitle" [level=2]
```

### 文本节点

🌐 Text nodes

独立或描述性文本元素显示为文本节点。

🌐 Standalone or descriptive text elements appear as text nodes.

```
<div>Sample accessible name</div>
```

_aria 快照_

```
- text: Sample accessible name
```

### 内联多行文本

🌐 Inline multiline text

多行文本（例如段落）在 aria 快照中被规范化。

🌐 Multiline text, such as paragraphs, is normalized in the aria snapshot.

```
<p>Line 1<br>Line 2</p>
```

_aria 快照_

```
- paragraph: Line 1 Line 2
```

### 链接

🌐 Links

链接显示其文本或由伪元素组成的内容。

🌐 Links display their text or composed content from pseudo-elements.

```
<a href="#more-info">Read more about Accessibility</a>
```

_aria 快照_

```
- link "Read more about Accessibility"
```

### 文本框

🌐 Text boxes

类型为 `text` 的输入元素显示其 `value` 属性的内容。

🌐 Input elements of type `text` show their `value` attribute content.

```
<input type="text" value="Enter your name">
```

_aria 快照_

```
- textbox: Enter your name
```

### 带有项目的列表

🌐 Lists with items

有序和无序列表包含其列表项。

🌐 Ordered and unordered lists include their list items.

```
<ul aria-label="Main Features">  <li>Feature 1</li>  <li>Feature 2</li></ul>
```

_aria 快照_

```
- list "Main Features":  - listitem: Feature 1  - listitem: Feature 2
```

### 分组元素

🌐 Grouped elements

组捕获嵌套元素，例如具有摘要内容的 `<details>` 元素。

🌐 Groups capture nested elements, such as `<details>` elements with summary content.

```
<details>  <summary>Summary</summary>  <p>Detail content here</p></details>
```

_aria 快照_

`- group: Summary`

### 属性和状态

🌐 Attributes and states

常用的 ARIA 属性，如 `checked`、`disabled`、`expanded`、`level`、`pressed` 和 `selected`，表示控件状态。

🌐 Commonly used ARIA attributes, like `checked`, `disabled`, `expanded`, `level`, `pressed`, and `selected`, represent control states.

#### 带有 `checked` 属性的复选框

🌐 Checkbox with `checked` attribute

```
<input type="checkbox" checked>
```

_aria 快照_

```
- checkbox [checked]
```

#### 带有 `pressed` 属性的按钮

🌐 Button with `pressed` attribute

```
<button aria-pressed="true">Toggle</button>
```

_aria 快照_

```
- button "Toggle" [pressed=true]
```
