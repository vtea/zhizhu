---
title: 组件（实验）
source_url: https://playwright.nodejs.cn/docs/test-components
fetched_at: 2026-04-29T02:57:28.664Z
---

# 组件（实验）

## 介绍

🌐 Introduction

Playwright Test 现在可以测试你的组件。

🌐 Playwright Test can now test your components.

## 示例

🌐 Example

典型的组件测试如下所示：

🌐 Here is what a typical component test looks like:

```ts
test('event should work', async ({ mount }) => {
  let clicked = false;  // Mount a component. Returns locator pointing to the component.  const component = await mount(    <Button title="提交" onClick={() => { clicked = true }}></Button>  );  // As with any Playwright test, assert locator text.  await expect(component).toContainText('Submit');  // Perform locator click. This will trigger the event.  await component.click();  // Assert that respective events have been fired.  expect(clicked).toBeTruthy();
});
```

## 如何开始

🌐 How to get started

将 Playwright Test 添加到现有项目非常容易。以下是为 React、Vue 或 Svelte 项目启用 Playwright Test 的步骤。

🌐 Adding Playwright Test to an existing project is easy. Below are the steps to enable Playwright Test for a React, Vue or Svelte project.

### 第1步：为你对应的框架安装 Playwright 组件测试

🌐 Step 1: Install Playwright Test for components for your respective framework

*   npm
*   yarn
*   pnpm

```bash
npm init playwright@latest -- --ct
```

此步骤在你的工作区中创建多个文件：

🌐 This step creates several files in your workspace:

playwright/index.html

```
<html lang="en">  <body>    <div id="root"></div>    <script type="module" src="./index.ts"></script>  </body></html>
```

该文件定义了一个 HTML 文件，用于在测试期间渲染组件。它必须包含带有 `id="root"` 的元素，这是组件挂载的位置。同时，它还必须链接名为 `playwright/index.{js,ts,jsx,tsx}` 的脚本。

🌐 This file defines an html file that will be used to render components during testing. It must contain element with `id="root"`, that's where components are mounted. It must also link the script called `playwright/index.{js,ts,jsx,tsx}`.

你可以使用此脚本在组件挂载的页面中包含样式表、应用主题并注入代码。它可以是 `.js`、`.ts`、`.jsx` 或 `.tsx` 文件。

🌐 You can include stylesheets, apply theme and inject code into the page where component is mounted using this script. It can be either a `.js`, `.ts`, `.jsx` or `.tsx` file.

playwright/index.ts

```
// Apply theme here, add anything your component needs at runtime here.
```

### 步骤 2. 创建一个测试文件 `src/App.spec.{ts,tsx}`

🌐 Step 2. Create a test file `src/App.spec.{ts,tsx}`

*   React
*   Svelte
*   Vue

app.spec.tsx

```ts
import { test, expect } from '@playwright/experimental-ct-react';
import App from './App';
test('should work', async ({ mount }) => {
  const component = await mount(<App />);  await expect(component).toContainText('Learn React');
});
```

### 第三步。做测试

🌐 Step 3. Run the tests

你可以使用 [VS Code 扩展](https://playwright.nodejs.cn/docs/getting-started-vscode) 或命令行运行测试。

🌐 You can run tests using the [VS Code extension](https://playwright.nodejs.cn/docs/getting-started-vscode) or the command line.

`npm run test-ct`

### 进一步阅读：配置报告、浏览器、追踪

🌐 Further reading: configure reporting, browsers, tracing

请参阅 [Playwright 配置](https://playwright.nodejs.cn/docs/test-configuration) 以配置你的项目。

🌐 Refer to [Playwright config](https://playwright.nodejs.cn/docs/test-configuration) for configuring your project.

## 测试故事

🌐 Test stories

当Playwright Test用于测试网页组件时，测试会在Node.js中运行，而组件则运行在真实浏览器中。这结合了两者的优点：组件运行在真实的浏览器环境中，触发真实的点击，执行真实的布局，以及可视化回归的可能。同时，测试可以使用Node.js的所有能力以及所有Playwright测试功能。因此，在组件测试过程中，同样可以进行并行、参数化、带有相同尸检追踪故事的测试。

🌐 When Playwright Test is used to test web components, tests run in Node.js, while components run in the real browser. This brings together the best of both worlds: components run in the real browser environment, real clicks are triggered, real layout is executed, visual regression is possible. At the same time, test can use all the powers of Node.js as well as all the Playwright Test features. As a result, the same parallel, parametrized tests with the same post-mortem Tracing story are available during component testing.

然而，这带来了一些限制：

🌐 This however, is introducing a number of limitations:

*   你不能将复杂的实时对象传递给你的组件。只能传递普通的 JavaScript 对象和内置类型，如字符串、数字、日期等。

```ts
test('this will work', async ({ mount }) => {
  const component = await mount(<ProcessViewer process={{ name: 'playwright' }}/>);
});
test('this will not work', async ({ mount }) => {
  // `process` is a Node object, we can't pass it to the browser and expect it to work.  const component = await mount(<ProcessViewer process={process}/>);
});
```

*   你无法在回调中将数据同步传递到组件：

```ts
test('this will not work', async ({ mount }) => {
  // () => 'red' callback lives in Node. If `ColorPicker` component in the browser calls the parameter function  // `colorGetter` it won't get result synchronously. It'll be able to get it via await, but that is not how  // components are typically built.  const component = await mount(<ColorPicker colorGetter={() => 'red'}/>);
});
```

绕过这些及其他限制的方法既快速又优雅：针对测试组件的每个使用场景，创建一个专门为测试设计的该组件封装器。这不仅可以减轻这些限制，还可以为测试提供强大的抽象能力，让你能够定义组件渲染的环境、主题及其他方面。

🌐 Working around these and other limitations is quick and elegant: for every use case of the tested component, create a wrapper of this component designed specifically for test. Not only it will mitigate the limitations, but it will also offer powerful abstractions for testing where you would be able to define environment, theme and other aspects of your component rendering.

假设你想测试以下组件：

🌐 Let's say you'd like to test following component:

input-media.tsx

```
import React from 'react';
type InputMediaProps = {
  // Media is a complex browser object we can't send to Node while testing.  onChange(media: Media): void;
};
export function InputMedia(props: InputMediaProps) {
  return <></> as any;
}
```

为你的组件创建一个故事文件：

🌐 Create a story file for your component:

input-media.story.tsx

```
import React from 'react';
import InputMedia from './import-media';
type InputMediaForTestProps = {
  onMediaChange(mediaName: string): void;
};
export function InputMediaForTest(props: InputMediaForTestProps) {
  // Instead of sending a complex `media` object to the test, send the media name.  return <InputMedia onChange={media => props.onMediaChange(media.name)} />;
}// Export more stories here.
```

然后通过测试故事来测试组件：

🌐 Then test the component via testing the story:

input-media.spec.tsx

```ts
import { test, expect } from '@playwright/experimental-ct-react';
import { InputMediaForTest } from './input-media.story.tsx';
test('changes the image', async ({ mount }) => {
  let mediaSelected: string | null = null;  const component = await mount(    <InputMediaForTest      onMediaChange={mediaName => {
  mediaSelected = mediaName;      }}    />  );  await component    .getByTestId('imageInput')    .setInputFiles('src/assets/logo.png');  await expect(component.getByAltText(/selected image/i)).toBeVisible();  await expect.poll(() => mediaSelected).toBe('logo.png');
});
```

因此，对于每个组件，你都会有一个故事文件，导出所有实际被测试的故事。这些故事存在于浏览器中，并将复杂对象“转换”为测试中可以访问的简单对象。

🌐 As a result, for every component you'll have a story file that exports all the stories that are actually tested. These stories live in the browser and "convert" complex object into the simple objects that can be accessed in the test.

## 在引擎盖下

🌐 Under the hood

以下是组件测试的工作原理：

🌐 Here is how component testing works:

*   执行测试后，Playwright 将创建测试所需的组件列表。
*   然后，它编译一个包含这些组件的包，并使用本地静态 Web 服务器为其提供服务。
*   在测试中的 `mount` 调用时，Playwright 会导航到该组件包的外观页面 `/playwright/index.html` 并告诉它渲染组件。
*   事件被编组回 Node.js 环境以进行验证。

Playwright 使用 [Vite](https://vitejs.dev/) 来创建组件包并进行服务。

🌐 Playwright is using [Vite](https://vitejs.dev/) to create the components bundle and serve it.

## API 参考

🌐 API reference

### props

安装时向组件提供属性。

🌐 Provide props to a component when mounted.

*   React
*   Svelte
*   Vue

component.spec.tsx

```ts
import { test } from '@playwright/experimental-ct-react';
test('props', async ({ mount }) => {
  const component = await mount(<Component msg="greetings" />);
});
```

### 回调/事件

🌐 callbacks / events

安装时向组件提供回调/事件。

🌐 Provide callbacks/events to a component when mounted.

*   React
*   Svelte
*   Vue

component.spec.tsx

```ts
import { test } from '@playwright/experimental-ct-react';
test('callback', async ({ mount }) => {
  const component = await mount(<Component onClick={() => {}} />);
});
```

### 子项/插槽

🌐 children / slots

安装时向组件提供子项/插槽。

🌐 Provide children/slots to a component when mounted.

*   React
*   Svelte
*   Vue

component.spec.tsx

```ts
import { test } from '@playwright/experimental-ct-react';
test('children', async ({ mount }) => {
  const component = await mount(<Component>Child</Component>);
});
```

### hooks

你可以使用 `beforeMount` 和 `afterMount` 钩子来配置你的应用。这可以让你设置应用路由、模拟服务器等，从而提供所需的灵活性。你还可以通过测试中的 `mount` 调用传递自定义配置，这些配置可以从 `hooksConfig` 夹具中访问。这包括在挂载组件之前或之后需要运行的任何配置。下面提供了一个配置路由的示例：

🌐 You can use `beforeMount` and `afterMount` hooks to configure your app. This lets you set up things like your app router, fake server etc. giving you the flexibility you need. You can also pass custom configuration from the `mount` call from a test, which is accessible from the `hooksConfig` fixture. This includes any config that needs to be run before or after mounting the component. An example of configuring a router is provided below:

*   React
*   Vue

playwright/index.tsx

```
import { beforeMount, afterMount } from '@playwright/experimental-ct-react/hooks';
import { BrowserRouter } from 'react-router-dom';
export type HooksConfig = {
  enableRouting?: boolean;
}beforeMount<HooksConfig>(async ({ App, hooksConfig }) => {
  if (hooksConfig?.enableRouting)    return <BrowserRouter><App /></BrowserRouter>;
});
```

src/pages/ProductsPage.spec.tsx

```json
import { test, expect } from '@playwright/experimental-ct-react';import type { HooksConfig } from '../playwright';import { ProductsPage } from './pages/ProductsPage';test('configure routing through hooks config', async ({ page, mount }) => {  const component = await mount<HooksConfig>(<ProductsPage />, {    hooksConfig: { enableRouting: true },  });  await expect(component.getByRole('link')).toHaveAttribute('href', '/products/42');});
```

### unmount

从 DOM 中卸载已挂载的组件。这对于测试组件卸载时的行为非常有用。使用场景包括测试“你确定要离开吗？”的弹窗，或确保事件处理程序得到正确清理以防止内存泄漏。

🌐 Unmount the mounted component from the DOM. This is useful for testing the component's behavior upon unmounting. Use cases include testing an "Are you sure you want to leave?" modal or ensuring proper cleanup of event handlers to prevent memory leaks.

*   React
*   Svelte
*   Vue

component.spec.tsx

```ts
import { test } from '@playwright/experimental-ct-react';
test('unmount', async ({ mount }) => {
  const component = await mount(<Component/>);  await component.unmount();
});
```

### update

更新已挂载组件的 props、插槽/子组件和/或事件/回调。这些组件输入可以随时改变，通常由父组件提供，但有时有必要确保你的组件对新的输入做出适当的响应。

🌐 Update props, slots/children, and/or events/callbacks of a mounted component. These component inputs can change at any time and are typically provided by the parent component, but sometimes it is necessary to ensure that your components behave appropriately to new inputs.

*   React
*   Svelte
*   Vue

component.spec.tsx

```ts
import { test } from '@playwright/experimental-ct-react';
test('update', async ({ mount }) => {
  const component = await mount(<Component/>);  await component.update(      <Component msg="greetings" onClick={() => {}}>Child</Component>  );
});
```

### 处理网络请求

🌐 Handling network requests

Playwright 提供了一个 **实验性** 的 `router` 工具，用于拦截和处理网络请求。使用 `router` 工具有两种方式：

🌐 Playwright provides an **experimental**`router` fixture to intercept and handle network requests. There are two ways to use the `router` fixture:

*   调用 `router.route(url, handler)`，其行为类似于 [page.route()](https://playwright.nodejs.cn/docs/api/class-page#page-route)。更多详细信息请参见 [网络模拟指南](https://playwright.nodejs.cn/docs/mock)。
*   调用 `router.use(handlers)` 并将 [MSW 库](https://msw.nodejs.cn/) 的请求处理程序传递给它。

以下是在测试中重用现有 MSW 处理程序的示例。

🌐 Here is an example of reusing your existing MSW handlers in the test.

```ts
import { handlers } from '@src/mocks/handlers';
test.beforeEach(async ({ router }) => {
  // install common handlers before each test  await router.use(...handlers);
});
test('example test', async ({ mount }) => {
  // test as usual, your handlers are active  // ...});
```

你还可以为特定测试引入一次性处理程序。

🌐 You can also introduce a one-off handler for a specific test.

```ts
import { http, HttpResponse } from 'msw';
test('example test', async ({ mount, router }) => {
  await router.use(http.get('/data', async ({ request }) => {
  return HttpResponse.json({ value: 'mocked' });  }));  // test as usual, your handler is active  // ...});
```

## 常见问题

🌐 Frequently asked questions

### `@playwright/test` 和 `@playwright/experimental-ct-{react,svelte,vue}` 有什么区别？

🌐 What's the difference between `@playwright/test` and `@playwright/experimental-ct-{react,svelte,vue}`?

```ts
test('…', async ({ mount, page, context }) => {
  // …});
```

`@playwright/experimental-ct-{react,svelte,vue}` 封装 `@playwright/test` 以提供一个额外的内置组件测试专用夹具，称为 `mount`：

*   React
*   Svelte
*   Vue

```json
import { test, expect } from '@playwright/experimental-ct-react';import HelloWorld from './HelloWorld';test.use({ viewport: { width: 500, height: 500 } });test('should work', async ({ mount }) => {  const component = await mount(<HelloWorld msg="greetings" />);  await expect(component).toContainText('Greetings');});
```

此外，它还添加了一些你可以在 `playwright-ct.config.{ts,js}` 中使用的配置选项。

🌐 Additionally, it adds some config options you can use in your `playwright-ct.config.{ts,js}`.

最后，在底层，每个测试都会重复使用 `context` 和 `page` 测试夹具，以加快组件测试的速度。它会在每个测试之间重置它们，因此在功能上应该等同于 `@playwright/test` 的保证，即每个测试都会获得一个全新的、独立的 `context` 和 `page` 测试夹具。

🌐 Finally, under the hood, each test re-uses the `context` and `page` fixture as a speed optimization for Component Testing. It resets them in between each test so it should be functionally equivalent to `@playwright/test`'s guarantee that you get a new, isolated `context` and `page` fixture per-test.

### 我有一个已经使用 Vite 的项目。我可以重用配置吗？

🌐 I have a project that already uses Vite. Can I reuse the config?

此时，Playwright 对打包工具没有依赖，因此它不会重用你现有的 Vite 配置。你的配置可能包含许多我们无法重用的内容。因此，目前你需要将路径映射和其他高级设置复制到 Playwright 配置的 `ctViteConfig` 属性中。

🌐 At this point, Playwright is bundler-agnostic, so it is not reusing your existing Vite config. Your config might have a lot of things we won't be able to reuse. So for now, you would copy your path mappings and other high level settings into the `ctViteConfig` property of Playwright config.

```json
import { defineConfig } from '@playwright/experimental-ct-react';export default defineConfig({  use: {    ctViteConfig: {      // ...    },  },});
```

你可以通过 Vite 配置指定插件来进行测试设置。请注意，一旦开始指定插件，你也需要负责指定框架插件，在本例中是 `vue()` ：

🌐 You can specify plugins via Vite config for testing settings. Note that once you start specifying plugins, you are responsible for specifying the framework plugin as well, `vue()` in this case:

```json
import { defineConfig, devices } from '@playwright/experimental-ct-vue';import { resolve } from 'path';import vue from '@vitejs/plugin-vue';import AutoImport from 'unplugin-auto-import/vite';import Components from 'unplugin-vue-components/vite';export default defineConfig({  testDir: './tests/component',  use: {    trace: 'on-first-retry',    ctViteConfig: {      plugins: [        vue(),        AutoImport({          imports: [            'vue',            'vue-router',            '@vueuse/head',            'pinia',            {              '@/store': ['useStore'],            },          ],          dts: 'src/auto-imports.d.ts',          eslintrc: {            enabled: true,          },        }),        Components({          dirs: ['src/components'],          extensions: ['vue'],        }),      ],      resolve: {        alias: {          '@': resolve(__dirname, './src'),        },      },    },  },});
```

### 如何使用 CSS 导入？

🌐 How do I use CSS imports?

如果你的组件导入了 CSS，Vite 会自动处理它。你也可以使用 CSS 预处理器，例如 Sass、Less 或 Stylus，Vite 也会自动处理它们，无需额外配置。不过，需要先安装对应的 CSS 预处理器。

🌐 If you have a component that imports CSS, Vite will handle it automatically. You can also use CSS pre-processors such as Sass, Less, or Stylus, and Vite will handle them as well without any additional configuration. However, corresponding CSS pre-processor needs to be installed.

Vite 对所有 CSS 模块有一个严格要求，必须命名为 `*.module.[css extension]`。如果你通常为项目有自定义构建配置，并且有类似 `import styles from 'styles.css'` 形式的导入，你必须重命名文件以正确表明它们将作为模块处理。你也可以编写一个 Vite 插件来为你处理这个问题。

🌐 Vite has a hard requirement that all CSS Modules are named `*.module.[css extension]`. If you have a custom build config for your project normally and have imports of the form `import styles from 'styles.css'` you must rename your files to properly indicate they are to be treated as modules. You could also write a Vite plugin to handle this for you.

请查阅 [Vite 文档](https://vite.dev/guide/features#css) 以获取更多详细信息。

🌐 Check [Vite documentation](https://vite.dev/guide/features#css) for more details.

### 如何测试使用 Pinia 的组件？

🌐 How can I test components that uses Pinia?

Pinia 需要在 `playwright/index.{js,ts,jsx,tsx}` 中初始化。如果你在 `beforeMount` 钩子中执行此操作，`initialState` 可以在每个测试中被覆盖：

🌐 Pinia needs to be initialized in `playwright/index.{js,ts,jsx,tsx}`. If you do this inside a `beforeMount` hook, the `initialState` can be overwritten on a per-test basis:

playwright/index.ts

```
import { beforeMount, afterMount } from '@playwright/experimental-ct-vue/hooks';
import { createTestingPinia } from '@pinia/testing';
import type { StoreState } from 'pinia';
import type { useStore } from '../src/store';
export type HooksConfig = {
  store?: StoreState<ReturnType<typeof useStore>>;
}beforeMount<HooksConfig>(async ({ hooksConfig }) => {
  createTestingPinia({
  initialState: hooksConfig?.store,    /**     * Use http intercepting to mock api calls instead:     * https://playwright.nodejs.cn/docs/mock#mock-api-requests     */    stubActions: false,    createSpy(args) {
  console.log('spy', args)      return () => console.log('spy-returns')    },  });
});
```

src/pinia.spec.ts

```json
import { test, expect } from '@playwright/experimental-ct-vue';import type { HooksConfig } from '../playwright';import Store from './Store.vue';test('override initialState ', async ({ mount }) => {  const component = await mount<HooksConfig>(Store, {    hooksConfig: {      store: { name: 'override initialState' }    }  });  await expect(component).toContainText('override initialState');});
```

### 如何访问组件的方法或其实例？

🌐 How do I access the component's methods or its instance?

在测试代码中访问组件的内部方法或其实例既不推荐也不被支持。相反，应专注于从用户的角度观察和与组件交互，通常通过点击或验证页面上的某些内容是否可见。当测试避免与内部实现细节（例如组件实例或其方法）交互时，测试会变得不那么脆弱且更有价值。请记住，如果从用户的角度运行测试时测试失败，这很可能意味着自动化测试发现了代码中的真实错误。

🌐 Accessing a component's internal methods or its instance within test code is neither recommended nor supported. Instead, focus on observing and interacting with the component from a user's perspective, typically by clicking or verifying if something is visible on the page. Tests become less fragile and more valuable when they avoid interacting with internal implementation details, such as the component instance or its methods. Keep in mind that if a test fails when run from a user’s perspective, it likely means the automated test has uncovered a genuine bug in your code.
