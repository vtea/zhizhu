---
title: 浏览器
source_url: https://playwright.nodejs.cn/docs/browsers
fetched_at: 2026-04-29T02:57:28.664Z
---

# 浏览器

## 介绍

🌐 Introduction

每个版本的 Playwright 都需要特定版本的浏览器二进制文件才能运行。你需要使用 Playwright CLI 来安装这些浏览器。

🌐 Each version of Playwright needs specific versions of browser binaries to operate. You will need to use the Playwright CLI to install these browsers.

每次发布时，Playwright 都会更新其支持的浏览器版本，因此最新的 Playwright 可以随时支持最新的浏览器。这意味着每次更新 Playwright 时，你可能需要重新运行 `install` 命令行工具命令。

🌐 With every release, Playwright updates the versions of the browsers it supports, so that the latest Playwright would support the latest browsers at any moment. It means that every time you update Playwright, you might need to re-run the `install` CLI command.

## 安装浏览器

🌐 Install browsers

Playwright 可以安装支持的浏览器。不带参数运行该命令将安装默认浏览器。

🌐 Playwright can install supported browsers. Running the command without arguments will install the default browsers.

```bash
npx playwright install
```

你还可以通过提供参数来安装特定的浏览器：

🌐 You can also install specific browsers by providing an argument:

```bash
npx playwright install webkit
```

查看所有支持的浏览器：

🌐 See all supported browsers:

```bash
npx playwright install --help
```

## 安装系统依赖

🌐 Install system dependencies

系统依赖可以自动安装。这对于持续集成环境很有用。

🌐 System dependencies can get installed automatically. This is useful for CI environments.

```bash
npx playwright install-deps
```

你还可以通过将其作为参数传递来安装单个浏览器的依赖：

🌐 You can also install the dependencies for a single browser by passing it as an argument:

```bash
npx playwright install-deps chromium
```

也可以将 `install-deps` 与 `install` 结合使用，从而通过一条命令安装浏览器和操作系统依赖。

🌐 It's also possible to combine `install-deps` with `install` so that the browsers and OS dependencies are installed with a single command.

```bash
npx playwright install --with-deps chromium
```

请参阅 [系统要求](https://playwright.nodejs.cn/docs/intro#system-requirements) 了解官方支持的操作系统。

🌐 See [system requirements](https://playwright.nodejs.cn/docs/intro#system-requirements) for officially supported operating systems.

🌐 Update Playwright regularly

通过保持你的 Playwright 版本为最新，你将能够使用新功能并在最新的浏览器版本上测试你的应用，并在最新的浏览器版本向公众发布之前捕获故障。

🌐 By keeping your Playwright version up to date you will be able to use new features and test your app on the latest browser versions and catch failures before the latest browser version is released to the public.

```
# Update playwrightnpm install -D @playwright/test@latest# Install new browsersnpx playwright install
```

查看[发行说明](https://playwright.nodejs.cn/docs/release-notes)以了解最新版本及已发布的更改内容。

🌐 Check the [release notes](https://playwright.nodejs.cn/docs/release-notes) to see what the latest version is and what changes have been released.

```
# See what version of Playwright you have by running the following commandnpx playwright --version
```

## 配置浏览器

🌐 Configure Browsers

Playwright 可以在 Chromium、WebKit 和 Firefox 浏览器以及品牌浏览器如 Google Chrome 和 Microsoft Edge 上运行测试。它还可以在模拟的平板和移动设备上运行。有关完整的桌面、平板和移动设备列表，请参阅[设备参数注册表](https://github.com/microsoft/playwright/blob/main/packages/playwright-core/src/server/deviceDescriptorsSource.json)。

🌐 Playwright can run tests on Chromium, WebKit and Firefox browsers as well as branded browsers such as Google Chrome and Microsoft Edge. It can also run on emulated tablet and mobile devices. See the [registry of device parameters](https://github.com/microsoft/playwright/blob/main/packages/playwright-core/src/server/deviceDescriptorsSource.json) for a complete list of selected desktop, tablet and mobile devices.

### 在不同浏览器上运行测试

🌐 Run tests on different browsers

Playwright 可以通过在配置中设置 **项目** 来在多个浏览器和配置中运行你的测试。你也可以为每个项目添加 [不同的选项](https://playwright.nodejs.cn/docs/test-configuration)。

🌐 Playwright can run your tests in multiple browsers and configurations by setting up **projects** in the config. You can also add [different options](https://playwright.nodejs.cn/docs/test-configuration) for each project.

```json
import { defineConfig, devices } from '@playwright/test';export default defineConfig({  projects: [    /* Test against desktop browsers */    {      name: 'chromium',      use: { ...devices['Desktop Chrome'] },    },    {      name: 'firefox',      use: { ...devices['Desktop Firefox'] },    },    {      name: 'webkit',      use: { ...devices['Desktop Safari'] },    },    /* Test against mobile viewports. */    {      name: 'Mobile Chrome',      use: { ...devices['Pixel 5'] },    },    {      name: 'Mobile Safari',      use: { ...devices['iPhone 12'] },    },    /* Test against branded browsers. */    {      name: 'Google Chrome',      use: { ...devices['Desktop Chrome'], channel: 'chrome' }, // or 'chrome-beta'    },    {      name: 'Microsoft Edge',      use: { ...devices['Desktop Edge'], channel: 'msedge' }, // or 'msedge-dev'    },  ],});
```

Playwright 将默认运行所有项目。

🌐 Playwright will run all projects by default.

```bash
npx playwright testRunning 7 tests using 5 workers  ✓ [chromium] › example.spec.ts:3:1 › basic test (2s)  ✓ [firefox] › example.spec.ts:3:1 › basic test (2s)  ✓ [webkit] › example.spec.ts:3:1 › basic test (2s)  ✓ [Mobile Chrome] › example.spec.ts:3:1 › basic test (2s)  ✓ [Mobile Safari] › example.spec.ts:3:1 › basic test (2s)  ✓ [Google Chrome] › example.spec.ts:3:1 › basic test (2s)  ✓ [Microsoft Edge] › example.spec.ts:3:1 › basic test (2s)
```

使用 `--project` 命令行选项运行单个项目。

🌐 Use the `--project` command line option to run a single project.

```bash
npx playwright test --project=firefoxRunning 1 test using 1 worker  ✓ [firefox] › example.spec.ts:3:1 › basic test (2s)
```

使用 VS Code 扩展程序，你可以通过在 Playwright 侧边栏的浏览器名称旁边勾选复选框来在不同的浏览器上运行测试。这些名称在你的 Playwright 配置文件的 projects 部分中定义。安装 Playwright 时的默认配置为你提供了三个项目：Chromium、Firefox 和 WebKit。默认情况下，第一个项目被选中。

🌐 With the VS Code extension you can run your tests on different browsers by checking the checkbox next to the browser name in the Playwright sidebar. These names are defined in your Playwright config file under the projects section. The default config when installing Playwright gives you 3 projects, Chromium, Firefox and WebKit. The first project is selected by default.

![Image 1: Projects section in VS Code extension](https://playwright.nodejs.cn/assets/images/vscode-projects-section-70d5aa3cdca55c2ab82a8fc0c493a87d.png)

要在多个项目（浏览器）上运行测试，请选中项目名称旁边的复选框来选择每个项目。

🌐 To run tests on multiple projects(browsers), select each project by checking the checkboxes next to the project name.

![Image 2: Selecting projects to run tests on](https://github.com/microsoft/playwright/assets/13063165/6dc86ef4-6097-481c-9cab-b6e053ec7ea6)

### Chromium

对于 Google Chrome、Microsoft Edge 以及其他基于 Chromium 的浏览器，Playwright 默认使用开源 Chromium 构建版本。由于 Chromium 项目领先于品牌浏览器，当全球用户使用 Google Chrome N 版本时，Playwright 已经支持 Chromium N+1，该版本将在几周后发布到 Google Chrome 和 Microsoft Edge 上。

🌐 For Google Chrome, Microsoft Edge and other Chromium-based browsers, by default, Playwright uses open source Chromium builds. Since the Chromium project is ahead of the branded browsers, when the world is on Google Chrome N, Playwright already supports Chromium N+1 that will be released in Google Chrome and Microsoft Edge a few weeks later.

### Chromium：无头浏览器

🌐 Chromium: headless shell

Playwright 提供了一个用于有头操作的常规 Chromium 版本，以及一个用于无头模式的独立 [chromium 无头壳](https://developer.chrome.com/blog/chrome-headless-shell)。

🌐 Playwright ships a regular Chromium build for headed operations and a separate [chromium headless shell](https://developer.chrome.com/blog/chrome-headless-shell) for headless mode.

如果你只是在无头模式下运行测试（即没有指定 `channel` 选项），例如在 CI 上，你可以在安装时通过传递 `--only-shell` 来避免下载完整的 Chromium 浏览器。

🌐 If you are only running tests in headless shell (i.e. the `channel` option is **not** specified), for example on CI, you can avoid downloading the full Chromium browser by passing `--only-shell` during installation.

```
# only running tests headlesslynpx playwright install --with-deps --only-shell
```

### Chromium：新的无头模式

🌐 Chromium: new headless mode

你可以通过使用 `'chromium'` 通道来选择新的无头模式。正如[官方 Chrome 文档所述](https://developer.chrome.com/blog/chrome-headless-shell)：

🌐 You can opt into the new headless mode by using `'chromium'` channel. As [official Chrome documentation puts it](https://developer.chrome.com/blog/chrome-headless-shell):

> 另一方面，新的无头模式是真正的 Chrome 浏览器，因此更真实、可靠，并提供更多功能。这使得它更适合进行高精度的端到端网络应用测试或浏览器扩展测试。

详情请参阅 [问题 #33566](https://github.com/microsoft/playwright/issues/33566)。

🌐 See [issue #33566](https://github.com/microsoft/playwright/issues/33566) for details.

```json
import { defineConfig, devices } from '@playwright/test';export default defineConfig({  projects: [    {      name: 'chromium',      use: { ...devices['Desktop Chrome'], channel: 'chromium' },    },  ],});
```

使用新的无头模式时，你可以通过使用 `--no-shell` 选项在浏览器安装过程中跳过下载无头浏览器：

🌐 With the new headless mode, you can skip downloading the headless shell during browser installation by using the `--no-shell` option:

```
# only running tests headlesslynpx playwright install --with-deps --no-shell
```

### 谷歌浏览器和微软 Edge

🌐 Google Chrome & Microsoft Edge

虽然 Playwright 可以下载并使用最新的 Chromium 构建，但它也可以操作机器上可用的带品牌的 Google Chrome 和 Microsoft Edge 浏览器（注意 Playwright 默认不会安装它们）。特别是，当前的 Playwright 版本将支持这些浏览器的稳定版和测试版渠道。

🌐 While Playwright can download and use the recent Chromium build, it can operate against the branded Google Chrome and Microsoft Edge browsers available on the machine (note that Playwright doesn't install them by default). In particular, the current Playwright version will support Stable and Beta channels of these browsers.

可用的通道有 `chrome`、`msedge`、`chrome-beta`、`msedge-beta`、`chrome-dev`、`msedge-dev`、`chrome-canary`、`msedge-canary`。

🌐 Available channels are `chrome`, `msedge`, `chrome-beta`, `msedge-beta`, `chrome-dev`, `msedge-dev`, `chrome-canary`, `msedge-canary`.

warning

某些企业浏览器策略可能会影响 Playwright 启动和控制 Google Chrome 以及 Microsoft Edge 的能力。在有浏览器策略的环境中运行不属于 Playwright 项目的范围。

🌐 Certain Enterprise Browser Policies may impact Playwright's ability to launch and control Google Chrome and Microsoft Edge. Running in an environment with browser policies is outside of the Playwright project's scope.

```json
import { defineConfig, devices } from '@playwright/test';export default defineConfig({  projects: [    /* Test against branded browsers. */    {      name: 'Google Chrome',      use: { ...devices['Desktop Chrome'], channel: 'chrome' }, // or 'chrome-beta'    },    {      name: 'Microsoft Edge',      use: { ...devices['Desktop Edge'], channel: 'msedge' }, // or "msedge-beta" or 'msedge-dev'    },  ],});
```

#### 安装 Google Chrome 和 Microsoft Edge

🌐 Installing Google Chrome & Microsoft Edge

如果你的计算机上没有 Google Chrome 或 Microsoft Edge，你可以使用 Playwright 命令行工具安装它们：

🌐 If Google Chrome or Microsoft Edge is not available on your machine, you can install them using the Playwright command line tool:

```bash
npx playwright install msedge
```

warning

Google Chrome 或 Microsoft Edge 安装将安装在操作系统的默认全局位置，覆盖当前的浏览器安装。

使用 `--help` 选项运行，以查看可以安装的浏览器完整列表。

🌐 Run with the `--help` option to see a full a list of browsers that can be installed.

#### 何时使用 Google Chrome 和 Microsoft Edge，何时不使用？

🌐 When to use Google Chrome & Microsoft Edge and when not to?

##### 默认值

🌐 Defaults

在大多数情况下，使用默认的 Playwright 配置和最新的 Chromium 是个不错的选择。由于 Playwright 的浏览器版本通常领先于稳定渠道，这可以让你放心，即即将发布的 Google Chrome 或 Microsoft Edge 不会破坏你的网站。你可以早早发现问题，并有足够的时间在官方 Chrome 更新之前进行修复。

🌐 Using the default Playwright configuration with the latest Chromium is a good idea most of the time. Since Playwright is ahead of Stable channels for the browsers, it gives peace of mind that the upcoming Google Chrome or Microsoft Edge releases won't break your site. You catch breakage early and have a lot of time to fix it before the official Chrome update.

##### 回归测试

🌐 Regression testing

话虽如此，测试策略通常要求对当前公开可用的浏览器进行回归测试。在这种情况下，你可以选择其中一个稳定通道，`"chrome"` 或 `"msedge"`。

🌐 Having said that, testing policies often require regression testing to be performed against the current publicly available browsers. In this case, you can opt into one of the stable channels, `"chrome"` or `"msedge"`.

##### 媒体编解码器

🌐 Media codecs

使用官方二进制文件进行测试的另一个原因是测试与媒体编解码器相关的功能。由于各种许可考虑和协议，Chromium 并不包含 Google Chrome 或 Microsoft Edge 所打包的所有编解码器。如果你的网站依赖于这种类型的编解码器（这种情况很少见），你也会希望使用官方版本。

🌐 Another reason for testing using official binaries is to test functionality related to media codecs. Chromium does not have all the codecs that Google Chrome or Microsoft Edge are bundling due to various licensing considerations and agreements. If your site relies on this kind of codecs (which is rarely the case), you will also want to use the official channel.

##### 企业政策

🌐 Enterprise policy

Google Chrome 和 Microsoft Edge 遵循企业政策，其中包括对功能、网络代理的限制，以及强制性扩展，这些都会影响测试。因此，如果你是使用这些政策的组织的一部分，最简单的方法是在本地测试时使用打包的 Chromium，同时你仍然可以选择在通常不受这些限制的机器人上使用稳定版本。

🌐 Google Chrome and Microsoft Edge respect enterprise policies, which include limitations to the capabilities, network proxy, mandatory extensions that stand in the way of testing. So if you are part of the organization that uses such policies, it is easiest to use bundled Chromium for your local testing, you can still opt into stable channels on the bots that are typically free of such restrictions.

### 火狐浏览器

🌐 Firefox

Playwright 的 Firefox 版本与最近的 [Firefox 稳定版](https://www.mozilla.org/en-US/firefox/new/) 构建匹配。Playwright 无法与官方品牌的 Firefox 一起使用，因为它依赖于补丁。

🌐 Playwright's Firefox version matches the recent [Firefox Stable](https://www.mozilla.org/en-US/firefox/new/) build. Playwright doesn't work with the branded version of Firefox since it relies on patches.

请注意，某些功能的可用性高度依赖于底层平台，在不同操作系统之间可能有所不同。例如，可用的媒体编解码器在 Linux、macOS 和 Windows 之间差异很大。

🌐 Note that availability of certain features, which depend heavily on the underlying platform, may vary between operating systems. For example, available media codecs vary substantially between Linux, macOS and Windows.

### WebKit

Playwright 的 WebKit 来源于最新的 WebKit 主分支源码，通常早于这些更新被集成到 Apple Safari 和其他基于 WebKit 的浏览器中。这为应对潜在的浏览器更新问题提供了充足的时间。由于 Playwright 依赖补丁，因此无法在官方版本的 Safari 上使用。相反，你可以使用最新的 WebKit 构建进行测试。

🌐 Playwright's WebKit is derived from the latest WebKit main branch sources, often before these updates are incorporated into Apple Safari and other WebKit-based browsers. This gives a lot of lead time to react on the potential browser update issues. Playwright doesn't work with the branded version of Safari since it relies on patches. Instead, you can test using the most recent WebKit build.

请注意，某些功能因底层平台而异，其可用性可能因作系统而异。例如，可用的媒体编解码器在Linux、macOS和Windows之间差异很大。虽然在Linux上运行WebKit CI通常是最经济实惠的选择，但如果你想体验最接近Safari，最好在Mac上运行WebKit，比如你做视频播放的话。

🌐 Note that availability of certain features, which depend heavily on the underlying platform, may vary between operating systems. For example, available media codecs vary substantially between Linux, macOS and Windows. While running WebKit on Linux CI is usually the most affordable option, for the closest-to-Safari experience you should run WebKit on mac, for example if you do video playback.

## 在防火墙或代理后面安装

🌐 Install behind a firewall or a proxy

默认情况下，Playwright 从 Microsoft 的 CDN 下载浏览器。

🌐 By default, Playwright downloads browsers from Microsoft's CDN.

有时公司会维护一个内部代理，阻止直接访问公共资源。在这种情况下，可以配置 Playwright 通过代理服务器下载浏览器。

🌐 Sometimes companies maintain an internal proxy that blocks direct access to the public resources. In this case, Playwright can be configured to download browsers via a proxy server.

*   Bash
*   PowerShell
*   Batch

```
HTTPS_PROXY=https://192.0.2.1 npx playwright install
```

如果代理的请求被带有自定义不受信任证书颁发机构 (CA) 的拦截，并且在下载浏览器时返回 `Error: self signed certificate in certificate chain`，你必须在安装浏览器之前通过 [`NODE_EXTRA_CA_CERTS`](https://nodejs.cn/api/cli.html#node_extra_ca_certsfile) 环境变量设置你的自定义根证书：

🌐 If the requests of the proxy get intercepted with a custom untrusted certificate authority (CA) and it yields to `Error: self signed certificate in certificate chain` while downloading the browsers, you must set your custom root certificates via the [`NODE_EXTRA_CA_CERTS`](https://nodejs.cn/api/cli.html#node_extra_ca_certsfile) environment variable before installing the browsers:

*   Bash
*   PowerShell
*   Batch

```
export NODE_EXTRA_CA_CERTS="/path/to/cert.pem"
```

如果你的网络连接 Playwright 浏览器存档较慢，可以使用 `PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT` 环境变量增加连接超时时间（以毫秒为单位）:

🌐 If your network is slow to connect to Playwright browser archive, you can increase the connection timeout in milliseconds with `PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT` environment variable:

*   Bash
*   PowerShell
*   Batch

```
PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT=120000 npx playwright install
```

如果你正在[安装依赖](http://playwright.nodejs.cn/docs/browsers#install-system-dependencies)并且需要在 Linux 上使用代理，请确保以 root 用户身份运行命令。否则，Playwright 会尝试提升为 root，但不会将像 `HTTPS_PROXY` 这样的环境变量传递给 Linux 包管理器。

🌐 If you are [installing dependencies](http://playwright.nodejs.cn/docs/browsers#install-system-dependencies) and need to use a proxy on Linux, make sure to run the command as a root user. Otherwise, Playwright will attempt to become a root and will not pass environment variables like `HTTPS_PROXY` to the linux package manager.

```
sudo HTTPS_PROXY=https://192.0.2.1 npx playwright install-deps
```

## 从工件存储库下载

🌐 Download from artifact repository

默认情况下，Playwright 从 Microsoft 的 CDN 下载浏览器。

🌐 By default, Playwright downloads browsers from Microsoft's CDN.

有时公司会维护一个内部工件仓库来存放浏览器二进制文件。在这种情况下，可以通过 `PLAYWRIGHT_DOWNLOAD_HOST` 环境变量将 Playwright 配置为从自定义位置下载。

🌐 Sometimes companies maintain an internal artifact repository to host browser binaries. In this case, Playwright can be configured to download from a custom location using the `PLAYWRIGHT_DOWNLOAD_HOST` env variable.

*   Bash
*   PowerShell
*   Batch

```
PLAYWRIGHT_DOWNLOAD_HOST=http://192.0.2.1 npx playwright install
```

也可以使用每个浏览器的下载主机，通过 `PLAYWRIGHT_CHROMIUM_DOWNLOAD_HOST`、`PLAYWRIGHT_FIREFOX_DOWNLOAD_HOST` 和 `PLAYWRIGHT_WEBKIT_DOWNLOAD_HOST` 环境变量来设置，这些变量优先于 `PLAYWRIGHT_DOWNLOAD_HOST`。

🌐 It is also possible to use a per-browser download hosts using `PLAYWRIGHT_CHROMIUM_DOWNLOAD_HOST`, `PLAYWRIGHT_FIREFOX_DOWNLOAD_HOST` and `PLAYWRIGHT_WEBKIT_DOWNLOAD_HOST` env variables that take precedence over `PLAYWRIGHT_DOWNLOAD_HOST`.

*   Bash
*   PowerShell
*   Batch

```
PLAYWRIGHT_FIREFOX_DOWNLOAD_HOST=http://203.0.113.3 PLAYWRIGHT_DOWNLOAD_HOST=http://192.0.2.1 npx playwright install
```

## 管理浏览器二进制文件

🌐 Managing browser binaries

Playwright 将 Chromium、WebKit 和 Firefox 浏览器下载到操作系统特定的缓存文件夹中：

🌐 Playwright downloads Chromium, WebKit and Firefox browsers into the OS-specific cache folders:

*   `%USERPROFILE%\AppData\Local\ms-playwright` 在 Windows 上
*   `~/Library/Caches/ms-playwright` 在 macOS 上
*   `~/.cache/ms-playwright` 在 Linux 上

这些浏览器安装后将占用数百兆磁盘空间：

🌐 These browsers will take a few hundred megabytes of disk space when installed:

```
du -hs ~/Library/Caches/ms-playwright/*281M  chromium-XXXXXX187M  firefox-XXXX180M  webkit-XXXX
```

你可以使用环境变量覆盖默认行为。安装 Playwright 时，可以指定让它将浏览器下载到特定位置：

🌐 You can override default behavior using environment variables. When installing Playwright, ask it to download browsers into a specific location:

*   Bash
*   PowerShell
*   Batch

```
PLAYWRIGHT_BROWSERS_PATH=$HOME/pw-browsers npx playwright install
```

运行 Playwright 脚本时，要求它在共享位置搜索浏览器。

🌐 When running Playwright scripts, ask it to search for browsers in a shared location.

*   Bash
*   PowerShell
*   Batch

```
PLAYWRIGHT_BROWSERS_PATH=$HOME/pw-browsers npx playwright test
```

Playwright 会跟踪需要这些浏览器的软件包，并在你将 Playwright 更新到较新版本时对它们进行垃圾收集。

🌐 Playwright keeps track of packages that need those browsers and will garbage collect them as you update Playwright to the newer versions.

note

开发者可以通过在他们的 `.bashrc` 中导出 `PLAYWRIGHT_BROWSERS_PATH=$HOME/pw-browsers` 来选择此模式。

🌐 Developers can opt-in in this mode via exporting `PLAYWRIGHT_BROWSERS_PATH=$HOME/pw-browsers` in their `.bashrc`.

### 密封安装

🌐 Hermetic install

你可以选择密封安装并将二进制文件放置在本地文件夹中：

🌐 You can opt into the hermetic install and place binaries in the local folder:

*   Bash
*   PowerShell
*   Batch

```
# Places binaries to node_modules/playwright-core/.local-browsersPLAYWRIGHT_BROWSERS_PATH=0 npx playwright install
```

note

`PLAYWRIGHT_BROWSERS_PATH` 不会更改 Google Chrome 和 Microsoft Edge 的安装路径。

### 旧浏览器删除

🌐 Stale browser removal

Playwright 会跟踪使用其浏览器的客户端。当不再有客户端需要特定版本的浏览器时，该版本会从系统中删除。这样，你可以安全地使用不同版本的 Playwright 实例，同时不会为不再使用的浏览器浪费磁盘空间。

🌐 Playwright keeps track of the clients that use its browsers. When there are no more clients that require a particular version of the browser, that version is deleted from the system. That way you can safely use Playwright instances of different versions and at the same time, you don't waste disk space for the browsers that are no longer in use.

要选择退出未使用浏览器的移除，你可以设置 `PLAYWRIGHT_SKIP_BROWSER_GC=1` 环境变量。

🌐 To opt-out from the unused browser removal, you can set the `PLAYWRIGHT_SKIP_BROWSER_GC=1` environment variable.

### 列出所有已安装的浏览器：

🌐 List all installed browsers:

打印机器上所有 Playwright 安装的浏览器列表。

🌐 Prints list of browsers from all playwright installations on the machine.

```bash
npx playwright install --list
```

### 卸载浏览器

🌐 Uninstall browsers

这将删除当前 Playwright 安装的浏览器（chromium、firefox、webkit）：

🌐 This will remove the browsers (chromium, firefox, webkit) of the current Playwright installation:

```bash
npx playwright uninstall
```

要同时删除其他 Playwright 安装的浏览器，请传递 `--all` 标志：

🌐 To remove browsers of other Playwright installations as well, pass `--all` flag:

```bash
npx playwright uninstall --all
```
