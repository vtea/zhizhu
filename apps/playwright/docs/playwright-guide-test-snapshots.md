---
title: 视觉比较
source_url: https://playwright.nodejs.cn/docs/test-snapshots
fetched_at: 2026-04-29T02:57:28.664Z
---

# 视觉比较

## 介绍

🌐 Introduction

Playwright 测试包含使用 `await expect(page).toHaveScreenshot()` 生成和视觉比较截图的功能。在首次执行时，Playwright 测试将生成参考截图。后续运行将与参考截图进行比较。

🌐 Playwright Test includes the ability to produce and visually compare screenshots using `await expect(page).toHaveScreenshot()`. On first execution, Playwright test will generate reference screenshots. Subsequent runs will compare against the reference.

example.spec.ts

```ts
import { test, expect } from '@playwright/test';
test('example test', async ({ page }) => {
  await page.goto('https://playwright.nodejs.cn');  await expect(page).toHaveScreenshot();
});
```

warning

浏览器渲染可能会因操作系统、版本、设置、硬件、电源（电池或电源适配器）、无头模式及其他因素而有所不同。为了获得一致的截图，请在生成基准截图的相同环境中运行测试。

## 生成屏幕截图

🌐 Generating screenshots

当你第一次运行上面时，测试运行程序会说：

🌐 When you run above for the first time, test runner will say:

```
Error: A snapshot doesn't exist at example.spec.ts-snapshots/example-test-1-chromium-darwin.png, writing actual.
```

那是因为还没有黄金文件。这个方法会截取一系列屏幕截图，直到连续两张截图相同，然后将最后一张截图保存到文件系统中。现在它已经可以添加到仓库中了。

🌐 That's because there was no golden file yet. This method took a bunch of screenshots until two consecutive screenshots matched, and saved the last screenshot to file system. It is now ready to be added to the repository.

具有黄金期望的文件夹的名称以测试文件的名称开头：

🌐 The name of the folder with the golden expectations starts with the name of your test file:

```
drwxr-xr-x  5 user  group  160 Jun  4 11:46 .drwxr-xr-x  6 user  group  192 Jun  4 11:45 ..-rw-r--r--  1 user  group  231 Jun  4 11:16 example.spec.tsdrwxr-xr-x  3 user  group   96 Jun  4 11:46 example.spec.ts-snapshots
```

快照名称 `example-test-1-chromium-darwin.png` 由几个部分组成：

🌐 The snapshot name `example-test-1-chromium-darwin.png` consists of a few parts:

*   `example-test-1.png` - 快照的自动生成名称。或者，你可以将快照名称作为 `toHaveScreenshot()` 方法的第一个参数指定：

```ts
await expect(page).toHaveScreenshot('landing.png');
```
*   `chromium-darwin` - 浏览器名称和平台。由于渲染、字体等不同，浏览器和平台之间的截图会有所不同，因此你需要为它们准备不同的快照。如果你在[配置文件](https://playwright.nodejs.cn/docs/test-configuration)中使用多个项目，将使用项目名称代替`chromium`。

快照名称和路径可以在 Playwright 配置中通过 [testConfig.snapshotPathTemplate](https://playwright.nodejs.cn/docs/api/class-testconfig#test-config-snapshot-path-template) 进行配置。

🌐 The snapshot name and path can be configured with [testConfig.snapshotPathTemplate](https://playwright.nodejs.cn/docs/api/class-testconfig#test-config-snapshot-path-template) in the playwright config.

> 请注意，`toHaveScreenshot()` 也接受指向快照文件的路径段数组，例如 `expect().toHaveScreenshot(['relative', 'path', 'to', 'snapshot.png'])`。 但是，此路径必须保存在每个测试文件的快照目录中（即 `a.spec.js-snapshots`），否则将会抛出错误。

## 更新截图

🌐 Updating screenshots

有时你需要更新参考截图，例如当页面发生变化时。可以使用 `--update-snapshots` 标志来操作。

🌐 Sometimes you need to update the reference screenshot, for example when the page has changed. Do this with the `--update-snapshots` flag.

```bash
npx playwright test --update-snapshots
```

## 选项

🌐 Options

### maxDiffPixels

Playwright Test 使用 [pixelmatch](https://github.com/mapbox/pixelmatch) 库。你可以 [传递各种选项](https://playwright.nodejs.cn/docs/api/class-pageassertions#page-assertions-to-have-screenshot-1) 来修改其行为：

🌐 Playwright Test uses the [pixelmatch](https://github.com/mapbox/pixelmatch) library. You can [pass various options](https://playwright.nodejs.cn/docs/api/class-pageassertions#page-assertions-to-have-screenshot-1) to modify its behavior:

example.spec.ts

```ts
import { test, expect } from '@playwright/test';
test('example test', async ({ page }) => {
  await page.goto('https://playwright.nodejs.cn');  await expect(page).toHaveScreenshot({ maxDiffPixels: 100 });
});
```

如果你想在项目中的所有测试之间共享默认值，你可以在全局或每个项目的 playwright 配置中指定它：

🌐 If you'd like to share the default value among all the tests in the project, you can specify it in the playwright config, either globally or per project:

playwright.config.ts

```json
import { defineConfig } from '@playwright/test';export default defineConfig({  expect: {    toHaveScreenshot: { maxDiffPixels: 100 },  },});
```

### stylePath

你可以在截取页面截图时应用自定义样式表。这可以过滤掉动态或易变的元素，从而提高截图的确定性。

🌐 You can apply a custom stylesheet to your page while taking screenshot. This allows filtering out dynamic or volatile elements, hence improving the screenshot determinism.

screenshot.css

```
iframe {
  visibility: hidden;
}
```

example.spec.ts

```ts
import { test, expect } from '@playwright/test';
test('example test', async ({ page }) => {
  await page.goto('https://playwright.nodejs.cn');  await expect(page).toHaveScreenshot({ stylePath: path.join(__dirname, 'screenshot.css') });
});
```

如果你想在项目中的所有测试之间共享默认值，你可以在全局或每个项目的 playwright 配置中指定它：

🌐 If you'd like to share the default value among all the tests in the project, you can specify it in the playwright config, either globally or per project:

playwright.config.ts

```json
import { defineConfig } from '@playwright/test';export default defineConfig({  expect: {    toHaveScreenshot: {      stylePath: './screenshot.css'    },  },});
```

## 非图片快照

🌐 Non-image snapshots

除了截图，你还可以使用 `expect(value).toMatchSnapshot(snapshotName)` 来比较文本或任意二进制数据。Playwright 测试会自动检测内容类型并使用相应的比较算法。

🌐 Apart from screenshots, you can use `expect(value).toMatchSnapshot(snapshotName)` to compare text or arbitrary binary data. Playwright Test auto-detects the content type and uses the appropriate comparison algorithm.

在这里，我们将文本内容与参考进行比较。

🌐 Here we compare text content against the reference.

example.spec.ts

```ts
import { test, expect } from '@playwright/test';
test('example test', async ({ page }) => {
  await page.goto('https://playwright.nodejs.cn');  expect(await page.textContent('.hero__title')).toMatchSnapshot('hero.txt');
});
```

快照存储在测试文件旁边的一个单独目录中。例如，`my.spec.ts` 文件会在 `my.spec.ts-snapshots` 目录中生成并存储快照。你应该将这个目录提交到版本控制（例如 `git`），并检查对其所做的任何更改。

🌐 Snapshots are stored next to the test file, in a separate directory. For example, `my.spec.ts` file will produce and store snapshots in the `my.spec.ts-snapshots` directory. You should commit this directory to your version control (e.g. `git`), and review any changes to it.
