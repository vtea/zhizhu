---
title: 跟踪查看器
source_url: https://playwright.nodejs.cn/docs/trace-viewer
fetched_at: 2026-04-29T02:57:28.664Z
---

# 跟踪查看器

## 介绍

🌐 Introduction

Playwright Trace Viewer 是一个图形化工具，帮助你在脚本运行后查看记录的 Playwright 跟踪。跟踪在测试在 CI 上失败时调试非常有用。你可以在本地[打开跟踪](http://playwright.nodejs.cn/docs/trace-viewer#opening-the-trace)，或者在浏览器中通过[trace.playwright.dev](https://trace.playwright.dev/) 查看。

🌐 Playwright Trace Viewer is a GUI tool that helps you explore recorded Playwright traces after the script has run. Traces are a great way for debugging your tests when they fail on CI. You can open traces [locally](http://playwright.nodejs.cn/docs/trace-viewer#opening-the-trace) or in your browser on [trace.playwright.dev](https://trace.playwright.dev/).

## 打开跟踪查看器

🌐 Opening Trace Viewer

你可以使用 Playwright CLI 或在浏览器中通过 [trace.playwright.dev](https://trace.playwright.dev/) 打开已保存的跟踪。请确保添加你的 `trace.zip` 文件所在的完整路径。

🌐 You can open a saved trace using either the Playwright CLI or in the browser at [trace.playwright.dev](https://trace.playwright.dev/). Make sure to add the full path to where your `trace.zip` file is located.

```bash
npx playwright show-trace path/to/trace.zip
```

### 使用 [trace.playwright.dev](https://trace.playwright.dev/)

🌐 Using trace.playwright.dev

[trace.playwright.dev](https://trace.playwright.dev/) 是 Trace Viewer 的静态托管版本。你可以通过拖放或点击 `Select file` 按钮上传 trace 文件。

Trace Viewer 会将跟踪完全加载到你的浏览器中，而不会向外部传输任何数据。

🌐 Trace Viewer loads the trace entirely in your browser and does not transmit any data externally.

![Image 1: Drop Playwright Trace to load](https://user-images.githubusercontent.com/13063165/194577918-b4d45726-2692-4093-8a28-9e73552617ef.png)

### 查看远程痕迹

🌐 Viewing remote traces

你可以直接使用其 URL 打开远程追踪。这使得查看远程追踪变得更加容易，而无需手动从 CI 运行中下载文件，例如。

🌐 You can open remote traces directly using its URL. This makes it easy to view the remote trace without having to manually download the file from CI runs, for example.

```bash
npx playwright show-trace https://example.com/trace.zip
```

在使用 [trace.playwright.dev](https://trace.playwright.dev/) 时，你也可以将上传的 trace 的 URL（存放在可访问的存储中，例如你的 CI 内）作为查询参数传递。可能会受 CORS（跨域资源共享）规则的限制。

🌐 When using [trace.playwright.dev](https://trace.playwright.dev/), you can also pass the URL of your uploaded trace at some accessible storage (e.g. inside your CI) as a query parameter. CORS (Cross-Origin Resource Sharing) rules might apply.

```
https://trace.playwright.dev/?trace=https://demo.playwright.dev/reports/todomvc/data/e6099cadf79aa753d5500aa9508f9d1dbd87b5ee.zip
```

## 记录跟踪

🌐 Recording a trace

### 本地跟踪

🌐 Tracing locally

在开发模式下记录跟踪时，在运行测试时将 `--trace` 标志设置为 `on`。你也可以使用 [UI 模式](https://playwright.nodejs.cn/docs/test-ui-mode) 来获得更好的开发者体验，因为它会自动跟踪每个测试。

🌐 To record a trace during development mode set the `--trace` flag to `on` when running your tests. You can also use [UI Mode](https://playwright.nodejs.cn/docs/test-ui-mode) for a better developer experience, as it traces each test automatically.

```bash
npx playwright test --trace on
```

然后，你可以打开 HTML 报告并单击跟踪图标以打开跟踪。

🌐 You can then open the HTML report and click on the trace icon to open the trace.

```bash
npx playwright show-report
```

### 在 CI 上跟踪

🌐 Tracing on CI

通过在测试配置文件中设置 `trace: 'on-first-retry'` 选项，应在失败测试的第一次重试时在持续集成上运行跟踪。这将为每个被重试的测试生成一个 `trace.zip` 文件。

🌐 Traces should be run on continuous integration on the first retry of a failed test by setting the `trace: 'on-first-retry'` option in the test configuration file. This will produce a `trace.zip` file for each test that was retried.

*   Test
*   Library

playwright.config.ts

```json
import { defineConfig } from '@playwright/test';export default defineConfig({  retries: 1,  use: {    trace: 'on-first-retry',  },});
```

记录跟踪的可用选项：

🌐 Available options to record a trace:

*   `'on-first-retry'` - 只有在第一次重试测试时才记录跟踪。
*   `'on-all-retries'` - 记录所有测试重试的痕迹。
*   `'off'` - 不要留下痕迹。
*   `'on'` - 为每个测试记录一次追踪。（不推荐，因为会影响性能）
*   `'retain-on-failure'` - 为每个测试记录跟踪，但在测试成功运行时将其移除。

如果你不启用重试，但仍希望对失败的测试进行追踪，也可以使用 `trace: 'retain-on-failure'`。

🌐 You can also use `trace: 'retain-on-failure'` if you do not enable retries but still want traces for failed tests.

还有更细化的选项可用，请参见 [testOptions.trace](https://playwright.nodejs.cn/docs/api/class-testoptions#test-options-trace)。

🌐 There are more granular options available, see [testOptions.trace](https://playwright.nodejs.cn/docs/api/class-testoptions#test-options-trace).

如果你没有使用 Playwright 作为测试运行器，请改用 [browserContext.tracing](https://playwright.nodejs.cn/docs/api/class-browsercontext#browser-context-tracing) API。

🌐 If you are not using Playwright as a Test Runner, use the [browserContext.tracing](https://playwright.nodejs.cn/docs/api/class-browsercontext#browser-context-tracing) API instead.

## 跟踪查看器功能

🌐 Trace Viewer features

### 行动

🌐 Actions

在动作标签页中，你可以看到每个动作用了哪个定位器，以及每个动作运行了多长时间。鼠标悬停在测试的每个动作上，直观地看到DOM快照中的变化。时光倒流，点击一个作来检查和调试。使用“前后”标签页，直观地查看动作前后发生了什么。

🌐 In the Actions tab you can see what locator was used for every action and how long each one took to run. Hover over each action of your test and visually see the change in the DOM snapshot. Go back and forward in time and click an action to inspect and debug. Use the Before and After tabs to visually see what happened before and after the action.

![Image 2: actions tab in trace viewer](https://github.com/microsoft/playwright/assets/13063165/948b65cd-f0fd-4c7f-8e53-2c632b5a07f1)

**选择每个操作显示：**

*   操作快照
*   操作日志
*   源代码位置

### 截图

🌐 Screenshots

在启用 [截图](https://playwright.nodejs.cn/docs/api/class-tracing#tracing-start-option-screenshots) 选项（默认）进行跟踪时，每次跟踪都会记录一个屏幕录制并将其渲染为影片条。你可以将鼠标悬停在影片条上，以查看每个操作和状态的放大图片，这可以帮助你轻松找到想要检查的操作。

🌐 When tracing with the [screenshots](https://playwright.nodejs.cn/docs/api/class-tracing#tracing-start-option-screenshots) option turned on (default), each trace records a screencast and renders it as a film strip. You can hover over the film strip to see a magnified image of for each action and state which helps you easily find the action you want to inspect.

双击某个操作以查看该操作的时间范围。你可以使用时间轴中的滑块来增加选择的操作，这些操作将显示在“操作”选项卡中，所有控制台日志和网络日志将被过滤，仅显示所选操作的日志。

🌐 Double click on an action to see the time range for that action. You can use the slider in the timeline to increase the actions selected and these will be shown in the Actions tab and all console logs and network logs will be filtered to only show the logs for the actions selected.

![Image 3: timeline view in trace viewer](https://github.com/microsoft/playwright/assets/13063165/b04a7d75-54bb-4ab2-9e30-e76f6f74a2c8)

### 快照

🌐 Snapshots

在启用 [快照](https://playwright.nodejs.cn/docs/api/class-tracing#tracing-start-option-snapshots) 选项（默认）进行跟踪时，Playwright 会为每个操作捕获一组完整的 DOM 快照。根据操作类型，它将捕获：

🌐 When tracing with the [snapshots](https://playwright.nodejs.cn/docs/api/class-tracing#tracing-start-option-snapshots) option turned on (default), Playwright captures a set of complete DOM snapshots for each action. Depending on the type of the action, it will capture:

| 类型 | 描述 |
| --- | --- |
| 之前 | 在调用动作时的快照。 |
| 动作 | 在执行输入的瞬间的快照。这种类型的快照在探索 Playwright 点击的具体位置时特别有用。 |
| 之后 | 动作之后的快照。 |

典型的操作快照如下所示：

🌐 Here is what the typical Action snapshot looks like:

![Image 4: action tab in trace viewer](https://github.com/microsoft/playwright/assets/13063165/7168d549-eb0a-4964-9c93-483f03711fa9)

请注意它如何高亮 DOM 节点以及确切的单击位置。

🌐 Notice how it highlights both, the DOM Node as well as the exact click position.

### 来源

🌐 Source

当你单击侧边栏中的某个操作时，该操作的代码行将在源面板中高亮。

🌐 When you click on an action in the sidebar, the line of code for that action is highlighted in the source panel.

![Image 5: showing source code tab in trace viewer](https://github.com/microsoft/playwright/assets/13063165/daa8845d-c250-4923-aa7a-5d040da9adc5)

### 调用

🌐 Call

调用选项卡向你显示有关操作的信息，例如所花费的时间、使用的定位器、是否处于严格模式以及使用的键。

🌐 The call tab shows you information about the action such as the time it took, what locator was used, if in strict mode and what key was used.

![Image 6: showing call tab in trace viewer](https://github.com/microsoft/playwright/assets/13063165/95498580-f9dd-4932-a123-c37fe7cfc3c2)

### 日志

🌐 Log

查看测试的完整日志，以更好地了解 Playwright 在幕后所做的事情，例如滚动到视图中、等待元素可见、启用和稳定以及执行单击、填充、按下等操作。

🌐 See a full log of your test to better understand what Playwright is doing behind the scenes such as scrolling into view, waiting for element to be visible, enabled and stable and performing actions such as click, fill, press etc.

![Image 7: showing log of tests in trace viewer](https://github.com/microsoft/playwright/assets/13063165/de621461-3bab-4140-b39d-9f02d6672dbf)

### 错误

🌐 Errors

如果你的测试失败，你将在“错误”标签中看到每个测试的错误信息。时间轴上也会显示一条红线，标出错误发生的位置。你还可以点击“源代码”标签，查看错误发生在源代码的哪一行。

🌐 If your test fails you will see the error messages for each test in the Errors tab. The timeline will also show a red line highlighting where the error occurred. You can also click on the source tab to see on which line of the source code the error is.

![Image 8: showing errors in trace viewer](https://github.com/microsoft/playwright/assets/13063165/e9ef77b3-05d1-4df2-852c-981023723d34)

### 控制台

🌐 Console

查看来自浏览器以及测试的控制台日志。会显示不同的图标，以告诉你控制台日志是来自浏览器还是测试文件。

🌐 See console logs from the browser as well as from your test. Different icons are displayed to show you if the console log came from the browser or from the test file.

![Image 9: showing log of tests in trace viewer](https://github.com/microsoft/playwright/assets/13063165/4107c08d-1eaf-421c-bdd4-9dd2aa641d4a)

在操作侧边栏中双击测试中的某个操作。这将筛选控制台，只显示在该操作期间生成的日志。点击 _显示全部_ 按钮可以再次查看所有控制台日志。

🌐 Double click on an action from your test in the actions sidebar. This will filter the console to only show the logs that were made during that action. Click the _Show all_ button to see all console logs again.

使用时间轴来筛选操作，方法是点击起点并拖动到终点。控制台选项卡也将仅显示在所选操作期间生成的日志。

🌐 Use the timeline to filter actions, by clicking a start point and dragging to an ending point. The console tab will also be filtered to only show the logs that were made during the actions selected.

### 网络

🌐 Network

网络选项卡显示了在测试期间发出的所有网络请求。你可以按请求类型、状态码、方法、请求、内容类型、持续时间和大小进行排序。点击某个请求可以查看更多信息，例如请求头、响应头、请求体和响应体。

🌐 The Network tab shows you all the network requests that were made during your test. You can sort by different types of requests, status code, method, request, content type, duration and size. Click on a request to see more information about it such as the request headers, response headers, request body and response body.

![Image 10: network requests tab in trace viewer](https://github.com/microsoft/playwright/assets/13063165/0a3d1671-8ccd-4f7a-a844-35f5eb37f236)

在操作侧边栏中双击测试中的某个操作。这将过滤网络请求，只显示在该操作期间发出的请求。点击 _显示全部_ 按钮可以再次查看所有网络请求。

🌐 Double click on an action from your test in the actions sidebar. This will filter the network requests to only show the requests that were made during that action. Click the _Show all_ button to see all network requests again.

使用时间轴来过滤操作，方法是点击起点并拖动到终点。网络标签也将被过滤，只显示所选操作期间发生的网络请求。

🌐 Use the timeline to filter actions, by clicking a start point and dragging to an ending point. The network tab will also be filtered to only show the network requests that were made during the actions selected.

### 元数据

🌐 Metadata

在“操作”选项卡旁边，你会看到“元数据”选项卡，它将显示有关你的测试的更多信息，例如浏览器、视口大小、测试持续时间等。

🌐 Next to the Actions tab you will find the Metadata tab which will show you more information on your test such as the Browser, viewport size, test duration and more.

![Image 11: meta data in trace viewer](https://github.com/microsoft/playwright/assets/13063165/82ab3d33-1ec9-4b8a-9cf2-30a6e2d59091)

### 附件

🌐 Attachments

"附件"选项卡允许你查看附件。如果你正在进行[视觉回归测试](https://playwright.nodejs.cn/docs/test-snapshots)，你可以通过检查图片差异、实际图片和预期图片来比较屏幕截图。当你点击预期图片时，你可以使用滑块将一张图片滑过另一张图片，从而轻松查看屏幕截图中的差异。

🌐 The "Attachments" tab allows you to explore attachments. If you're doing [visual regression testing](https://playwright.nodejs.cn/docs/test-snapshots), you'll be able to compare screenshots by examining the image diff, the actual image and the expected image. When you click on the expected image you can use the slider to slide one image over the other so you can easily see the differences in your screenshots.

![Image 12: attachments tab in trace viewer](https://github.com/microsoft/playwright/assets/13063165/4386178a-5808-4fa8-9436-315350a23b04)
