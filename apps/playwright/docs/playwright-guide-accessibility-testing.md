---
title: 无障碍测试
source_url: https://playwright.nodejs.cn/docs/accessibility-testing
fetched_at: 2026-04-29T02:57:28.664Z
---

# 无障碍测试

## 介绍

🌐 Introduction

Playwright 可用于测试你的应用是否存在多种类型的可访问性问题。

🌐 Playwright can be used to test your application for many types of accessibility issues.

这可以捕获的一些问题示例包括：

🌐 A few examples of problems this can catch include:

*   由于与背景的颜色对比度较差，有视力障碍的用户难以阅读文本
*   UI 控件和表单元素没有屏幕阅读器可以识别的标签
*   具有重复 ID 的交互元素可能会混淆辅助技术

以下示例依赖于 [`@axe-core/playwright`](https://npmjs.org/@axe-core/playwright) 包，该包增加了在 Playwright 测试中运行 [axe 可访问性测试引擎](https://www.deque.com/axe/) 的支持。

🌐 The following examples rely on the [`@axe-core/playwright`](https://npmjs.org/@axe-core/playwright) package which adds support for running the [axe accessibility testing engine](https://www.deque.com/axe/) as part of your Playwright tests.

Disclaimer

自动化无障碍测试可以检测一些常见的无障碍问题，如缺失或无效属性。但许多无障碍问题只能通过人工测试发现。我们建议结合自动化测试、手动无障碍评估和包容性用户测试。

🌐 Automated accessibility tests can detect some common accessibility problems such as missing or invalid properties. But many accessibility problems can only be discovered through manual testing. We recommend using a combination of automated testing, manual accessibility assessments, and inclusive user testing.

对于手动评估，我们推荐 [Accessibility Insights for Web](https://accessibilityinsights.io/docs/web/overview/?referrer=playwright-accessibility-testing-js)，这是一款免费且开源的开发工具，可引导你评估网站的 [WCAG 2.1 AA](https://www.w3.org/WAI/WCAG21/quickref/?currentsidebar=%23col_customize&levels=aaa) 覆盖情况。

🌐 For manual assessments, we recommend [Accessibility Insights for Web](https://accessibilityinsights.io/docs/web/overview/?referrer=playwright-accessibility-testing-js), a free and open source dev tool that walks you through assessing a website for [WCAG 2.1 AA](https://www.w3.org/WAI/WCAG21/quickref/?currentsidebar=%23col_customize&levels=aaa) coverage.

## 可访问性测试示例

🌐 Example accessibility tests

无障碍测试的工作方式和其他 Playwright 测试一样。你可以为它们创建单独的测试用例，也可以将无障碍扫描和断言集成到现有的测试用例中。

🌐 Accessibility tests work just like any other Playwright test. You can either create separate test cases for them, or integrate accessibility scans and assertions into your existing test cases.

以下示例演示了一些基本的可访问性测试场景。

🌐 The following examples demonstrate a few basic accessibility testing scenarios.

### 扫描整个页面

🌐 Scanning an entire page

此示例演示了如何测试整个页面的自动可检测的无障碍违规情况。测试内容如下：

🌐 This example demonstrates how to test an entire page for automatically detectable accessibility violations. The test:

1.   导入 `@axe-core/playwright` 包
2.   使用普通的 Playwright Test 语法来定义测试用例
3.   使用正常的 Playwright 语法导航到正在测试的页面
4.   等待 `AxeBuilder.analyze()` 对页面运行无障碍扫描
5.   使用普通的 Playwright 测试[断言](https://playwright.nodejs.cn/docs/test-assertions)来验证返回的扫描结果中没有违规情况

*   TypeScript
*   JavaScript

```ts
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright'; // 1test.describe('homepage', () => { // 2  test('should not have any automatically detectable accessibility issues', async ({ page }) => {
  await page.goto('https://your-site.com/'); // 3    const accessibilityScanResults = await new AxeBuilder({ page }).analyze(); // 4    expect(accessibilityScanResults.violations).toEqual([]); // 5  });
});
```

### 配置 axe 扫描页面的特定部分

🌐 Configuring axe to scan a specific part of a page

`@axe-core/playwright` 支持许多 axe 的配置选项。你可以使用 `AxeBuilder` 类通过 Builder 模式来指定这些选项。

例如，你可以使用 [`AxeBuilder.include()`](https://github.com/dequelabs/axe-core-npm/blob/develop/packages/playwright/README.md#axebuilderincludeselector-string--string) 将可访问性扫描限制为仅针对页面的特定部分运行。

🌐 For example, you can use [`AxeBuilder.include()`](https://github.com/dequelabs/axe-core-npm/blob/develop/packages/playwright/README.md#axebuilderincludeselector-string--string) to constrain an accessibility scan to only run against one specific part of a page.

`AxeBuilder.analyze()` 在你调用它时会扫描页面的 _当前状态_。要扫描根据用户界面交互显示的页面部分，请在调用 `analyze()` 之前使用 [Locators](https://playwright.nodejs.cn/docs/locators) 与页面进行交互：

```ts
test('navigation menu should not have automatically detectable accessibility violations', async ({
  page,}) => {
  await page.goto('https://your-site.com/');  await page.getByRole('button', { name: 'Navigation Menu' }).click();  // It is important to waitFor() the page to be in the desired  // state *before* running analyze(). Otherwise, axe might not  // find all the elements your test expects it to scan.  await page.locator('#navigation-menu-flyout').waitFor();  const accessibilityScanResults = await new AxeBuilder({ page })      .include('#navigation-menu-flyout')      .analyze();  expect(accessibilityScanResults.violations).toEqual([]);
});
```

### 扫描 WCAG 违规行为

🌐 Scanning for WCAG violations

默认情况下，axe 会检查各种可访问性规则。其中一些规则对应于《网页内容可访问性指南（WCAG）》的特定成功标准，另一些则是“最佳实践”规则，并非任何 WCAG 标准所明确要求的。

🌐 By default, axe checks against a wide variety of accessibility rules. Some of these rules correspond to specific success criteria from the [Web Content Accessibility Guidelines (WCAG)](https://www.w3.org/TR/WCAG21/), and others are "best practice" rules that are not specifically required by any WCAG criterion.

你可以通过使用 [`AxeBuilder.withTags()`](https://github.com/dequelabs/axe-core-npm/blob/develop/packages/playwright/README.md#axebuilderwithtagstags-stringarray) 将无障碍扫描限制为仅运行那些被标记为对应特定 WCAG 成功标准的规则。例如，[Web 的无障碍洞察的自动检查](https://accessibilityinsights.io/docs/web/getstarted/fastpass/?referrer=playwright-accessibility-testing-js) 只包括测试 WCAG A 和 AA 成功标准违规的 axe 规则；要匹配该行为，你可以使用标签 `wcag2a`、`wcag2aa`、`wcag21a` 和 `wcag21aa`。

🌐 You can constrain an accessibility scan to only run those rules which are "tagged" as corresponding to specific WCAG success criteria by using [`AxeBuilder.withTags()`](https://github.com/dequelabs/axe-core-npm/blob/develop/packages/playwright/README.md#axebuilderwithtagstags-stringarray). For example, [Accessibility Insights for Web's Automated Checks](https://accessibilityinsights.io/docs/web/getstarted/fastpass/?referrer=playwright-accessibility-testing-js) only include axe rules that test for violations of WCAG A and AA success criteria; to match that behavior, you would use the tags `wcag2a`, `wcag2aa`, `wcag21a`, and `wcag21aa`.

请注意，自动化测试无法检测所有类型的 WCAG 违规行为。

🌐 Note that automated testing cannot detect all types of WCAG violations.

```ts
test('should not have any automatically detectable WCAG A or AA violations', async ({ page }) => {
  await page.goto('https://your-site.com/');  const accessibilityScanResults = await new AxeBuilder({ page })      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])      .analyze();  expect(accessibilityScanResults.violations).toEqual([]);
});
```

你可以在 [axe API 文档的“Axe-core 标签”部分](https://www.deque.com/axe/core-documentation/api-documentation/#axecore-tags) 中找到 axe-core 支持的规则标签的完整列表。

🌐 You can find a complete listing of the rule tags axe-core supports in [the "Axe-core Tags" section of the axe API documentation](https://www.deque.com/axe/core-documentation/api-documentation/#axecore-tags).

## 处理已知问题

🌐 Handling known issues

在给应用添加无障碍测试时，常见的问题是“我如何屏蔽已知的违规行为？”以下示例演示了你可以使用的一些技巧。

🌐 A common question when adding accessibility tests to an application is "how do I suppress known violations?" The following examples demonstrate a few techniques you can use.

### 从扫描中排除单个元素

🌐 Excluding individual elements from a scan

如果你的应用包含一些已知问题的特定元素，你可以使用 [`AxeBuilder.exclude()`](https://github.com/dequelabs/axe-core-npm/blob/develop/packages/playwright/README.md#axebuilderexcludeselector-string--string) 将它们排除在扫描之外，直到你能够修复这些问题。

🌐 If your application contains a few specific elements with known issues, you can use [`AxeBuilder.exclude()`](https://github.com/dequelabs/axe-core-npm/blob/develop/packages/playwright/README.md#axebuilderexcludeselector-string--string) to exclude them from being scanned until you're able to fix the issues.

这通常是最简单的选择，但它有一些重要的缺点：

🌐 This is usually the simplest option, but it has some important downsides:

*   `exclude()` 将排除指定的元素 _及其所有子元素_。避免在包含大量子元素的组件中使用它。
*   `exclude()` 将阻止 _所有_ 规则在指定元素上运行，而不仅仅是针对已知问题的规则。

以下是在一项特定测试中排除一个元素进行扫描的示例：

🌐 Here is an example of excluding one element from being scanned in one specific test:

```ts
test('should not have any accessibility violations outside of elements with known issues', async ({
  page,}) => {
  await page.goto('https://your-site.com/page-with-known-issues');  const accessibilityScanResults = await new AxeBuilder({ page })      .exclude('#element-with-known-issue')      .analyze();  expect(accessibilityScanResults.violations).toEqual([]);
});
```

如果相关元素在许多页面中反复使用，可以考虑[使用测试夹具](http://playwright.nodejs.cn/docs/accessibility-testing#using-a-test-fixture-for-common-axe-configuration)在多个测试中重用相同的 `AxeBuilder` 配置。

🌐 If the element in question is used repeatedly in many pages, consider [using a test fixture](http://playwright.nodejs.cn/docs/accessibility-testing#using-a-test-fixture-for-common-axe-configuration) to reuse the same `AxeBuilder` configuration across multiple tests.

### 禁用个别扫描规则

🌐 Disabling individual scan rules

如果你的应用中存在许多不同的特定规则的已有违规情况，你可以使用 [`AxeBuilder.disableRules()`](https://github.com/dequelabs/axe-core-npm/blob/develop/packages/playwright/README.md#axebuilderdisablerulesrules-stringarray) 暂时禁用单个规则，直到你能够修复这些问题。

🌐 If your application contains many different preexisting violations of a specific rule, you can use [`AxeBuilder.disableRules()`](https://github.com/dequelabs/axe-core-npm/blob/develop/packages/playwright/README.md#axebuilderdisablerulesrules-stringarray) to temporarily disable individual rules until you're able to fix the issues.

你可以在要抑制的违规项的 `id` 属性中找到传递给 `disableRules()` 的规则 ID。`axe-core` 的文档中可以找到 [axe 规则的完整列表](https://github.com/dequelabs/axe-core/blob/master/doc/rule-descriptions.md)。

🌐 You can find the rule IDs to pass to `disableRules()` in the `id` property of the violations you want to suppress. A [complete list of axe's rules](https://github.com/dequelabs/axe-core/blob/master/doc/rule-descriptions.md) can be found in `axe-core`'s documentation.

```ts
test('should not have any accessibility violations outside of rules with known issues', async ({
  page,}) => {
  await page.goto('https://your-site.com/page-with-known-issues');  const accessibilityScanResults = await new AxeBuilder({ page })      .disableRules(['duplicate-id'])      .analyze();  expect(accessibilityScanResults.violations).toEqual([]);
});
```

### 使用快照来解决特定的已知问题

🌐 Using snapshots to allow specific known issues

如果你希望允许更细化的已知问题集合，可以使用 [快照](https://playwright.nodejs.cn/docs/test-snapshots) 来验证一组已有的违规是否未发生变化。这种方法避免了使用 `AxeBuilder.exclude()` 的缺点，但代价是稍微增加了复杂性和脆弱性。

🌐 If you would like to allow for a more granular set of known issues, you can use [Snapshots](https://playwright.nodejs.cn/docs/test-snapshots) to verify that a set of preexisting violations has not changed. This approach avoids the downsides of using `AxeBuilder.exclude()` at the cost of slightly more complexity and fragility.

不要使用整个 `accessibilityScanResults.violations` 数组的快照。它包含了相关元素的实现细节，例如它们渲染的 HTML 片段；如果你在快照中包含这些内容，每当其中一个组件因无关原因发生变化时，你的测试就可能容易失败。

🌐 Do not use a snapshot of the entire `accessibilityScanResults.violations` array. It contains implementation details of the elements in question, such as a snippet of their rendered HTML; if you include these in your snapshots, it will make your tests prone to breaking every time one of the components in question changes for an unrelated reason:

```ts
// Don't do this! This is fragile.expect(accessibilityScanResults.violations).toMatchSnapshot();
```

相反，为相关违规行为创建一个 _指纹_，其中仅包含唯一标识该问题所需的信息，并使用指纹的快照：

🌐 Instead, create a _fingerprint_ of the violation(s) in question that contains only enough information to uniquely identify the issue, and use a snapshot of the fingerprint:

```ts
// This is less fragile than snapshotting the entire violations array.expect(violationFingerprints(accessibilityScanResults)).toMatchSnapshot();
// my-test-utils.jsfunction violationFingerprints(accessibilityScanResults) {
  const violationFingerprints = accessibilityScanResults.violations.map(violation => ({
  rule: violation.id,    // These are CSS selectors which uniquely identify each element with    // a violation of the rule in question.    targets: violation.nodes.map(node => node.target),  }));  return JSON.stringify(violationFingerprints, null, 2);
}
```

## 将扫描结果导出为测试附件

🌐 Exporting scan results as a test attachment

大多数无障碍性测试主要关注 axe 扫描结果的 `violations` 属性。然而，扫描结果不仅仅包含 `violations`。例如，结果还包含关于通过规则的信息以及 axe 发现对某些规则结果不确定的元素的信息。这些信息对于调试未检测到所有预期违规的测试非常有用。

🌐 Most accessibility tests are primarily concerned with the `violations` property of the axe scan results. However, the scan results contain more than just `violations`. For example, the results also contain information about rules which passed and about elements which axe found to have inconclusive results for some rules. This information can be useful for debugging tests that aren't detecting all the violations you expect them to.

为了将 _所有_ 扫描结果作为调试用途的测试结果的一部分，你可以使用 [`testInfo.attach()`](https://playwright.nodejs.cn/docs/api/class-testinfo#test-info-attach) 将扫描结果添加为测试附件。[报告器](https://playwright.nodejs.cn/docs/test-reporters) 随后可以将完整结果嵌入或链接为测试输出的一部分。

🌐 To include _all_ of the scan results as part of your test results for debugging purposes, you can add the scan results as a test attachment with [`testInfo.attach()`](https://playwright.nodejs.cn/docs/api/class-testinfo#test-info-attach). [Reporters](https://playwright.nodejs.cn/docs/test-reporters) can then embed or link the full results as part of your test output.

以下示例演示了将扫描结果附加到测试：

🌐 The following example demonstrates attaching scan results to a test:

```ts
test('example with attachment', async ({ page }, testInfo) => {
  await page.goto('https://your-site.com/');  const accessibilityScanResults = await new AxeBuilder({ page }).analyze();  await testInfo.attach('accessibility-scan-results', {
  body: JSON.stringify(accessibilityScanResults, null, 2),    contentType: 'application/json'  });  expect(accessibilityScanResults.violations).toEqual([]);
});
```

## 使用通用轴配置的测试夹具

🌐 Using a test fixture for common axe configuration

[测试夹具](https://playwright.nodejs.cn/docs/test-fixtures) 是在多个测试中共享常见 `AxeBuilder` 配置的好方法。一些可能有用的场景包括：

*   在所有测试中使用一组通用规则
*   抑制出现在许多不同页面中的公共元素中的已知违规行为
*   为多次扫描一致地附加独立的可访问性报告

以下示例演示了创建和使用涵盖每个场景的测试装置。

🌐 The following example demonstrates creating and using a test fixture that covers each of those scenarios.

### 创建夹具

🌐 Creating a fixture

这个示例夹具创建了一个预先配置了共享 `withTags()` 和 `exclude()` 配置的 `AxeBuilder` 对象。

🌐 This example fixture creates an `AxeBuilder` object which is pre-configured with shared `withTags()` and `exclude()` configuration.

*   TypeScript
*   JavaScript

axe-test.ts

```ts
import { test as base } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
type AxeFixture = {
  makeAxeBuilder: () => AxeBuilder;
};
// Extend base test by providing "makeAxeBuilder"//// This new "test" can be used in multiple test files, and each of them will get// a consistently configured AxeBuilder instance.export const test = base.extend<AxeFixture>({
  makeAxeBuilder: async ({ page }, use) => {
  const makeAxeBuilder = () => new AxeBuilder({ page })        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])        .exclude('#commonly-reused-element-with-known-issue');    await use(makeAxeBuilder);  }});
export { expect } from '@playwright/test';
```

### 使用夹具

🌐 Using a fixture

要使用该夹具，请将之前示例中的 `new AxeBuilder({ page })` 替换为新定义的 `makeAxeBuilder` 夹具：

🌐 To use the fixture, replace the earlier examples' `new AxeBuilder({ page })` with the newly defined `makeAxeBuilder` fixture:

```ts
const { test, expect } = require('./axe-test');
test('example using custom fixture', async ({ page, makeAxeBuilder }) => {
  await page.goto('https://your-site.com/');  const accessibilityScanResults = await makeAxeBuilder()      // Automatically uses the shared AxeBuilder configuration,      // but supports additional test-specific configuration too      .include('#specific-element-under-test')      .analyze();  expect(accessibilityScanResults.violations).toEqual([]);
});
```
