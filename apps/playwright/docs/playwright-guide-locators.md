---
title: Untitled
source_url: https://playwright.nodejs.cn/docs/locators
fetched_at: 2026-04-29T02:57:28.664Z
---

# Untitled

- 指南定位器On this page定位器 ## 介绍​ 🌐 Introduction [定位器]是 Playwright 自动等待和重试能力的核心部分。简而言之，定位器表示在任何时刻在页面上查找元素的一种方式。 ### 快速指南​ 🌐 Quick Guide 这些是推荐的内置定位器。 🌐 These are the recommended built-in locators. page.getByRole() 通过显式和隐式的可访问性属性进行定位。

- page.getByText() 用于按文本内容定位。

- page.getByLabel() 根据关联标签的文本定位表单控件。

- page.getByPlaceholder() 通过占位符定位输入框。

- page.getByAltText() 用于通过元素的替代文本（通常是图片）来定位元素。

- page.getByTitle() 用于通过元素的 title 属性定位元素。

- page.getByTestId() to locate an element based on its data-testid attribute (other attributes can be configured).

```
await page.getByLabel('User Name').fill('John');
await page.getByLabel('Password').fill('secret-password');
await page.getByRole('button', { name: 'Sign in' }).click();
await expect(page.getByText('Welcome, John!')).toBeVisible();

```

## 定位元素​

🌐 Locating elements

Playwright 自带多种内置定位器。为了提高测试的稳健性，我们建议优先使用面向用户的属性和显式契约，例如 page.getByRole()。

🌐 Playwright comes with multiple built-in locators. To make tests resilient, we recommend prioritizing user-facing attributes and explicit contracts such as page.getByRole().

例如，考虑以下 DOM 结构。

🌐 For example, consider the following DOM structure.

http://localhost:3000登录

```
button>Sign inbutton>
```

通过其 button 角色和名称“登录”定位该元素。

🌐 Locate the element by its role of button with name "Sign in".

```
await page.getByRole('button', { name: 'Sign in' }).click();

```

note使用代码生成器生成定位器，然后根据需要进行编辑。 每次使用定位器执行操作时，页面中都会定位到最新的 DOM 元素。在下面的代码片段中，底层 DOM 元素将被定位两次，每次操作前都会定位一次。这意味着如果在调用之间由于重新渲染而 DOM 发生变化，将会使用与定位器对应的新元素。

🌐 Every time a locator is used for an action, an up-to-date DOM element is located in the page. In the snippet below, the underlying DOM element will be located twice, once prior to every action. This means that if the DOM changes in between the calls due to re-render, the new element corresponding to the locator will be used.

```
const locator = page.getByRole('button', { name: 'Sign in' });
await locator.hover();
await locator.click();

```

请注意，所有创建定位器的方法，例如 page.getByLabel()，在 Locator 和 FrameLocator 类中也可用，因此你可以链式调用它们，并逐步缩小定位器的范围。

🌐 Note that all methods that create a locator, such as page.getByLabel(), are also available on the Locator and FrameLocator classes, so you can chain them and iteratively narrow down your locator.

```
const locator = page    .frameLocator('#my-frame')    .getByRole('button', { name: 'Sign in' });
await locator.click();

```

### 按角色定位​

🌐 Locate by role

page.getByRole() 定位器反映了用户和辅助技术如何感知页面，例如某个元素是按钮还是复选框。使用角色定位时，通常也应传递可访问名称，这样定位器才能准确找到具体元素。

🌐 The page.getByRole() locator reflects how users and assistive technology perceive the page, for example whether some element is a button or a checkbox. When locating by role, you should usually pass the accessible name as well, so that the locator pinpoints the exact element.

例如，考虑以下 DOM 结构。

🌐 For example, consider the following DOM structure.

http://localhost:3000

### 注册

订阅提交 ``` h3>Sign uph3>label> input type="checkbox" /> Subscribelabel>br/>button>Submitbutton> ``` 你可以通过其隐含角色来定位每个元素：

🌐 You can locate each element by its implicit role:

```
await expect(page.getByRole('heading', { name: 'Sign up' })).toBeVisible();
await page.getByRole('checkbox', { name: 'Subscribe' }).check();
await page.getByRole('button', { name: /submit/i }).click();

```

角色定位器包括按钮、复选框、标题、链接、列表、表格以及更多，并遵循 W3C 对ARIA 角色、ARIA 属性 和可访问名称的规范。请注意，许多 HTML 元素如  拥有隐式定义的角色，角色定位器能够识别该角色。

🌐 Role locators include buttons, checkboxes, headings, links, lists, tables, and many more and follow W3C specifications for ARIA role, ARIA attributes and accessible name. Note that many html elements like  have an implicitly defined role that is recognized by the role locator.

请注意，角色定位器并不取代无障碍审计和合规测试，而是提供关于ARIA指南的早期反馈。

🌐 Note that role locators do not replace accessibility audits and conformance tests, but rather give early feedback about the ARIA guidelines.

When to use role locators我们建议优先使用角色定位器来定位元素，因为这是最接近用户和辅助技术感知页面的方式。🌐 We recommend prioritizing role locators to locate elements, as it is the closest way to how users and assistive technology perceive the page. ### 按标签定位​ 🌐 Locate by label

大多数表单控件通常都有专门的标签，可以方便地用于与表单交互。在这种情况下，你可以使用其关联的标签通过 page.getByLabel() 定位控件。

🌐 Most form controls usually have dedicated labels that could be conveniently used to interact with the form. In this case, you can locate the control by its associated label using page.getByLabel().

例如，考虑以下 DOM 结构。

🌐 For example, consider the following DOM structure.

http://localhost:3000Password 

```
label>Password input type="password" />label>
```

你可以在通过标签文本找到它后填充输入：

🌐 You can fill the input after locating it by the label text:

```
await page.getByLabel('Password').fill('secret');

```

When to use label locatorsUse this locator when locating form fields. ### 通过占位符定位​ 🌐 Locate by placeholder

输入框可能有一个 placeholder 属性，用于提示用户应该输入什么值。你可以使用 page.getByPlaceholder() 定位这样的输入框。

🌐 Inputs may have a placeholder attribute to hint to the user what value should be entered. You can locate such an input using page.getByPlaceholder().

例如，考虑以下 DOM 结构。

🌐 For example, consider the following DOM structure.

http://localhost:3000

```
input type="email" placeholder="name@example.com" />
```

你可以在通过占位符文本找到输入后填充输入：

🌐 You can fill the input after locating it by the placeholder text:

```
await page    .getByPlaceholder('name@example.com')    .fill('playwright@microsoft.com');

```

When to use placeholder locatorsUse this locator when locating form elements that do not have labels but do have placeholder texts. ### 通过文本定位​ 🌐 Locate by text

通过元素包含的文本查找元素。使用 page.getByText() 时，可以按子字符串、完整字符串或正则表达式进行匹配。

🌐 Find an element by the text it contains. You can match by a substring, exact string, or a regular expression when using page.getByText().

例如，考虑以下 DOM 结构。

🌐 For example, consider the following DOM structure.

http://localhost:3000欢迎, John

```
span>Welcome, Johnspan>
```

你可以通过元素包含的文本来定位该元素：

🌐 You can locate the element by the text it contains:

```
await expect(page.getByText('Welcome, John')).toBeVisible();

```

设置精确匹配：

🌐 Set an exact match:

```
await expect(page.getByText('Welcome, John', { exact: true })).toBeVisible();

```

与正则表达式匹配：

🌐 Match with a regular expression:

```
await expect(page.getByText(/welcome, [A-Za-z]+$/i)).toBeVisible();

```

note文本匹配总是会规范化空白字符，即使是完全匹配。例如，它会将多个空格变为一个，将换行符变为空格，并忽略开头和结尾的空白。 When to use text locatorsWe recommend using text locators to find non interactive elements like div, span, p, etc. For interactive elements like button, a, input, etc. use role locators. 你也可以按文本过滤，这在尝试在列表中找到某个特定项目时非常有用。

🌐 You can also filter by text which can be useful when trying to find a particular item in a list.

### 通过替代文本定位​

🌐 Locate by alt text

所有图片都应有一个描述图片的 alt 属性。你可以使用 page.getByAltText() 根据替代文本定位图片。

🌐 All images should have an alt attribute that describes the image. You can locate an image based on the text alternative using page.getByAltText().

例如，考虑以下 DOM 结构。

🌐 For example, consider the following DOM structure.

http://localhost:3000

```
img alt="playwright logo" src="/img/playwright-logo.svg" width="100" />
```

你可以通过文本替代找到图片后单击该图片：

🌐 You can click on the image after locating it by the text alternative:

```
await page.getByAltText('playwright logo').click();

```

When to use alt locatorsUse this locator when your element supports alt text such as img and area elements. ### 按标题定位​ 🌐 Locate by title

使用 page.getByTitle() 查找具有匹配标题属性的元素。

🌐 Locate an element with a matching title attribute using page.getByTitle().

例如，考虑以下 DOM 结构。

🌐 For example, consider the following DOM structure.

http://localhost:300025 期

```
span title='问题数量'>25 issuesspan>
```

你可以通过标题文本找到问题后查看问题数：

🌐 You can check the issues count after locating it by the title text:

```
await expect(page.getByTitle('Issues count')).toHaveText('25 issues');

```

When to use title locatorsUse this locator when your element has the title attribute. ### 通过测试 id 定位​ 🌐 Locate by test id

通过测试ID进行测试是最稳健的测试方式，即使属性的文本或角色发生变化，测试仍然会通过。QA和开发者应该定义明确的测试ID，并使用 page.getByTestId() 查询它们。然而，通过测试ID进行测试并不面向用户。如果角色或文本值对你很重要，那么可以考虑使用面向用户的定位器，例如 role 和 text locators。

🌐 Testing by test ids is the most resilient way of testing as even if your text or role of the attribute changes, the test will still pass. QA's and developers should define explicit test ids and query them with page.getByTestId(). However testing by test ids is not user facing. If the role or text value is important to you then consider using user facing locators such as role and text locators.

例如，考虑以下 DOM 结构。

🌐 For example, consider the following DOM structure.

http://localhost:3000路由

```
button data-testid="directions">Itinérairebutton>
```

你可以通过元素的测试 ID 来定位该元素：

🌐 You can locate the element by its test id:

```
await page.getByTestId('directions').click();

```

When to use testid locatorsYou can also use test ids when you choose to use the test id methodology or when you can't locate by role or text. 设置自定义测试 id 属性​ 🌐 Set a custom test id attribute

默认情况下，page.getByTestId() 会根据 data-testid 属性定位元素，但你可以在测试配置中或通过调用 selectors.setTestIdAttribute() 配置它。

🌐 By default, page.getByTestId() will locate elements based on the data-testid attribute, but you can configure it in your test config or by calling selectors.setTestIdAttribute().

设置测试 ID 以在测试中使用自定义数据属性。

🌐 Set the test id to use a custom data attribute for your tests.

playwright.config.ts

```
import { defineConfig } from '@playwright/test';
export default defineConfig({  use: {    testIdAttribute: 'data-pw'  }});

```

在你的 HTML 中，你现在可以使用 data-pw 作为测试 ID，而不是默认的 data-testid。

🌐 In your html you can now use data-pw as your test id instead of the default data-testid.

http://localhost:3000路由

```
button data-pw="directions">Itinérairebutton>
```

然后像平常一样找到该元素：

🌐 And then locate the element as you would normally do:

```
await page.getByTestId('directions').click();

```

### 通过 CSS 或 XPath 定位​

🌐 Locate by CSS or XPath

如果你确实必须使用 CSS 或 XPath 定位器，你可以使用 page.locator() 来创建一个定位器，该定位器使用一个选择器来描述如何在页面中查找元素。Playwright 支持 CSS 和 XPath 选择器，如果你省略 css= 或 xpath= 前缀，它会自动检测选择器类型。

🌐 If you absolutely must use CSS or XPath locators, you can use page.locator() to create a locator that takes a selector describing how to find an element in the page. Playwright supports CSS and XPath selectors, and auto-detects them if you omit css= or xpath= prefix.

```
await page.locator('css=button').click();
await page.locator('xpath=//button').click();
await page.locator('button').click();
await page.locator('//button').click();

```

XPath 和 CSS 选择器可以与 DOM 结构或实现绑定。当 DOM 结构发生变化时，这些选择器可能会失效。下面的长 CSS 或 XPath 链是不良做法的一个例子，会导致测试不稳定：

🌐 XPath and CSS selectors can be tied to the DOM structure or implementation. These selectors can break when the DOM structure changes. Long CSS or XPath chains below are an example of a bad practice that leads to unstable tests:

```
await page.locator(    '#tsf > div:nth-child(2) > div.A8SBwf > div.RNNXgb > div > div.a4bIc > input').click();
await page    .locator('//*[@id="tsf"]/div[2]/div[1]/div[1]/div/div[2]/input')    .click();

```

When to use thisCSS and XPath are not recommended as the DOM can often change leading to non resilient tests. Instead, try to come up with a locator that is close to how the user perceives the page such as role locators or define an explicit testing contract using test ids. ## 定位在 Shadow DOM 中​ 🌐 Locate in Shadow DOM

在 Playwright 中，默认情况下 所有定位器都可以操作 Shadow DOM 中的元素。例外情况有：

🌐 All locators in Playwright by default work with elements in Shadow DOM. The exceptions are:

- 通过 XPath 定位不会穿透影子根。

- 封闭模式 shadow roots 不被支持。

请考虑以下带有自定义 Web 组件的示例：

🌐 Consider the following example with a custom web component:

```
x-details role=button aria-expanded=true aria-controls=inner-details>  div>Titlediv>  #shadow-root    div id=inner-details>Detailsdiv>x-details>
```

你可以采用与影子根根本不存在相同的方式进行定位。

🌐 You can locate in the same way as if the shadow root was not present at all.

要点击 Details：

🌐 To click Details:

```
await page.getByText('Details').click();

```

```
x-details role=button aria-expanded=true aria-controls=inner-details>  div>Titlediv>  #shadow-root    div id=inner-details>Detailsdiv>x-details>
```

要点击 ：

🌐 To click :

```
await page.locator('x-details', { hasText: 'Details' }).click();

```

```
x-details role=button aria-expanded=true aria-controls=inner-details>  div>Titlediv>  #shadow-root    div id=inner-details>Detailsdiv>x-details>
```

确保  包含文本 "Details":

🌐 To ensure that  contains the text "Details":

```
await expect(page.locator('x-details')).toContainText('Details');

```

## 过滤定位器​

🌐 Filtering Locators

考虑以下 DOM 结构，我们想要点击第二个产品卡片的购买按钮。我们有几种方法可以筛选定位器以找到正确的按钮。

🌐 Consider the following DOM structure where we want to click on the buy button of the second product card. We have a few options in order to filter the locators to get the right one.

http://localhost:3000- ### 产品 1 加入购物车 ### 产品 2 加入购物车 ``` ul> li> h3>Product 1h3> button>Add to cartbutton> li> li> h3>Product 2h3> button>Add to cartbutton> li>ul> ``` ### 按文本过滤​ 🌐 Filter by text 可以使用 locator.filter() 方法通过文本过滤定位器。它会在元素内部的某个位置（可能是在子元素中）查找特定字符串，并且不区分大小写。你也可以传入一个正则表达式。 🌐 Locators can be filtered by text with the locator.filter() method. It will search for a particular string somewhere inside the element, possibly in a descendant element, case-insensitively. You can also pass a regular expression. ``` await page .getByRole('listitem') .filter({ hasText: 'Product 2' }) .getByRole('button', { name: 'Add to cart' }) .click(); ``` 使用正则表达式： 🌐 Use a regular expression: ``` await page .getByRole('listitem') .filter({ hasText: /Product 2/ }) .getByRole('button', { name: 'Add to cart' }) .click(); ``` ### 通过不包含文本进行过滤​ 🌐 Filter by not having text 或者，通过不包含文本来筛选： 🌐 Alternatively, filter by not having text: ``` // 5 in-stock itemsawait expect(page.getByRole('listitem').filter({ hasNotText: 'Out of stock' })).toHaveCount(5); ``` ### 按子级/后代过滤​ 🌐 Filter by child/descendant 定位器支持一个选项，仅选择具有或不具有与其他定位器匹配的子元素的元素。因此，你可以通过任何其他定位器进行筛选，例如 locator.getByRole()、locator.getByTestId()、locator.getByText() 等。 🌐 Locators support an option to only select elements that have or have not a descendant matching another locator. You can therefore filter by any other locator such as a locator.getByRole(), locator.getByTestId(), locator.getByText() etc. http://localhost:3000 ### 产品 1 加入购物车 ### 产品 2 加入购物车 ``` ul> li> h3>Product 1h3> button>Add to cartbutton> li> li> h3>Product 2h3> button>Add to cartbutton> li>ul> ``` ``` await page .getByRole('listitem') .filter({ has: page.getByRole('heading', { name: 'Product 2' }) }) .getByRole('button', { name: 'Add to cart' }) .click(); ``` 我们还可以断言产品卡以确保只有一张： 🌐 We can also assert the product card to make sure there is only one: ``` await expect(page .getByRole('listitem') .filter({ has: page.getByRole('heading', { name: 'Product 2' }) })) .toHaveCount(1); ``` 筛选定位符必须相对于原始定位符，并且查询是从原始定位符匹配开始的，而不是从文档根开始。因此，以下方法将无法工作，因为筛选定位符是从原始定位符匹配的  列表项之外的  列表元素开始匹配的： 🌐 The filtering locator must be relative to the original locator and is queried starting with the original locator match, not the document root. Therefore, the following will not work, because the filtering locator starts matching from the  list element that is outside of the  list item matched by the original locator: ``` // ✖ WRONGawait expect(page .getByRole('listitem') .filter({ has: page.getByRole('list').getByText('Product 2') })) .toHaveCount(1); ``` ### 按没有子级/后代进行过滤​ 🌐 Filter by not having child/descendant 我们也可以筛选出内部没有匹配元素的情况。 🌐 We can also filter by not having a matching element inside. ``` await expect(page .getByRole('listitem') .filter({ hasNot: page.getByText('Product 2') })) .toHaveCount(1); ``` 请注意，内部定位器是从外部定位器开始匹配的，而不是从文档根开始匹配。 🌐 Note that the inner locator is matched starting from the outer one, not from the document root. ## 定位器运算符​ 🌐 Locator operators ### 定位器内部匹配​ 🌐 Matching inside a locator 你可以将创建定位器的方法链式调用，比如 page.getByText() 或 locator.getByRole()，以将搜索范围缩小到页面的特定部分。 🌐 You can chain methods that create a locator, like page.getByText() or locator.getByRole(), to narrow down the search to a particular part of the page. 在这个例子中，我们首先通过定位其 listitem 角色来创建一个名为 product 的定位器。然后我们使用文本进行过滤。我们可以再次使用 product 定位器，通过按钮角色获取并点击它，然后使用断言来确保文本为“Product 2”的产品只有一个。 🌐 In this example we first create a locator called product by locating its role of listitem. We then filter by text. We can use the product locator again to get by role of button and click it and then use an assertion to make sure there is only one product with the text "Product 2". ``` const product = page.getByRole('listitem').filter({ hasText: 'Product 2' }); await product.getByRole('button', { name: 'Add to cart' }).click(); await expect(product).toHaveCount(1); ``` 你也可以将两个定位器链接在一起，例如在特定对话框中找到“保存”按钮： 🌐 You can also chain two locators together, for example to find a "Save" button inside a particular dialog: ``` const saveButton = page.getByRole('button', { name: 'Save' }); // ...const dialog = page.getByTestId('settings-dialog'); await dialog.locator(saveButton).click(); ``` ### 同时匹配两个定位器​ 🌐 Matching two locators simultaneously 方法 locator.and() 通过匹配额外的定位器来缩小现有定位器的范围。例如，你可以结合 page.getByRole() 和 page.getByTitle() 来同时按角色和标题匹配。 🌐 Method locator.and() narrows down an existing locator by matching an additional locator. For example, you can combine page.getByRole() and page.getByTitle() to match by both role and title. ``` const button = page.getByRole('button').and(page.getByTitle('Subscribe')); ``` ### 匹配两个替代定位器之一​ 🌐 Matching one of the two alternative locators 如果你想定位两个或多个元素中的任意一个，并且不知属性体会是哪一个，可以使用 locator.or() 创建一个匹配任意一个或两个备选项的定位器。 🌐 If you'd like to target one of the two or more elements, and you don't know which one it will be, use locator.or() to create a locator that matches any one or both of the alternatives. 例如，考虑这样一种情景：你想点击“新建邮件”按钮，但有时会弹出安全设置对话框。在这种情况下，你可以等待“新建邮件”按钮出现，或者等待对话框出现，并据此采取相应的操作。 🌐 For example, consider a scenario where you'd like to click on a "New email" button, but sometimes a security settings dialog shows up instead. In this case, you can wait for either a "New email" button, or a dialog and act accordingly. note如果屏幕上同时出现“新建电子邮件”按钮和安全对话框，“或”定位器将匹配它们两者，可能会抛出“严格模式违规”错误。在这种情况下，你可以使用locator.first()只匹配其中一个。🌐 If both "New email" button and security dialog appear on screen, the "or" locator will match both of them, possibly throwing the "strict mode violation" error. In this case, you can use locator.first() to only match one of them. ``` const newEmail = page.getByRole('button', { name: 'New' }); const dialog = page.getByText('Confirm security settings'); await expect(newEmail.or(dialog).first()).toBeVisible(); if (await dialog.isVisible()) await page.getByRole('button', { name: 'Dismiss' }).click(); await newEmail.click(); ``` ### 仅匹配可见元素​ 🌐 Matching only visible elements note通常最好找到一种更可靠的方式来唯一标识该元素，而不是检查其可见性。🌐 It's usually better to find a more reliable way to uniquely identify the element instead of checking the visibility. 考虑一个页面上有两个按钮，第一个按钮是不可见的，第二个按钮是可见的 visible。 🌐 Consider a page with two buttons, the first invisible and the second visible. ``` button style='display: none'>Invisiblebutton>button>Visiblebutton> ``` 这将找到两个按钮并抛出一个 strictness 违规错误： ``` await page.locator('button').click(); ```

- 这只会找到第二个按钮，因为它是可见的，然后单击它。 ``` await page.locator('button').filter({ visible: true }).click(); ```

## 列表​

🌐 Lists

### 计算列表中的项目数​

🌐 Count items in a list

你可以断言定位器以计算列表中的项目数。

🌐 You can assert locators in order to count the items in a list.

例如，考虑以下 DOM 结构：

🌐 For example, consider the following DOM structure:

http://localhost:3000苹果香蕉橙子

```
ul>  li>appleli>  li>bananali>  li>orangeli>ul>
```

使用 count 断言确保列表有 3 个项目。

🌐 Use the count assertion to ensure that the list has 3 items.

```
await expect(page.getByRole('listitem')).toHaveCount(3);

```

### 断言列表中的所有文本​

🌐 Assert all text in a list

你可以断言定位器以查找列表中的所有文本。

🌐 You can assert locators in order to find all the text in a list.

例如，考虑以下 DOM 结构：

🌐 For example, consider the following DOM structure:

http://localhost:3000苹果香蕉橙子

```
ul>  li>appleli>  li>bananali>  li>orangeli>ul>
```

使用 expect(locator).toHaveText() 来确保列表中包含文本“apple”、“banana”和“orange”。

🌐 Use expect(locator).toHaveText() to ensure that the list has the text "apple", "banana" and "orange".

```
await expect(page    .getByRole('listitem'))    .toHaveText(['apple', 'banana', 'orange']);

```

### 获取特定项目​

🌐 Get a specific item

有多种方法可以获取列表中的特定项目。

🌐 There are many ways to get a specific item in a list.

通过文本获取​

🌐 Get by text

使用 page.getByText() 方法通过文本内容在列表中定位元素，然后点击它。

🌐 Use the page.getByText() method to locate an element in a list by its text content and then click on it.

例如，考虑以下 DOM 结构：

🌐 For example, consider the following DOM structure:

http://localhost:3000苹果香蕉橙子

```
ul>  li>appleli>  li>bananali>  li>orangeli>ul>
```

通过文本内容找到项目并单击它。

🌐 Locate an item by its text content and click it.

```
await page.getByText('orange').click();

```

按文本过滤​

🌐 Filter by text

使用 locator.filter() 在列表中定位特定项。

🌐 Use the locator.filter() to locate a specific item in a list.

例如，考虑以下 DOM 结构：

🌐 For example, consider the following DOM structure:

http://localhost:3000苹果香蕉橙子

```
ul>  li>appleli>  li>bananali>  li>orangeli>ul>
```

通过角色为“listitem”来定位一个项目，然后按文本“orange”进行过滤，然后点击它。

🌐 Locate an item by the role of "listitem" and then filter by the text of "orange" and then click it.

```
await page    .getByRole('listitem')    .filter({ hasText: 'orange' })    .click();

```

通过测试 id 获取​

🌐 Get by test id

使用 page.getByTestId() 方法在列表中定位元素。如果你还没有测试 ID，可能需要修改 HTML 并添加一个测试 ID。

🌐 Use the page.getByTestId() method to locate an element in a list. You may need to modify the html and add a test id if you don't already have a test id.

例如，考虑以下 DOM 结构：

🌐 For example, consider the following DOM structure:

http://localhost:3000苹果香蕉橙子

```
ul>  li data-testid='apple'>appleli>  li data-testid='banana'>bananali>  li data-testid='orange'>orangeli>ul>
```

通过其测试 ID “orange” 找到一个项目，然后点击它。

🌐 Locate an item by its test id of "orange" and then click it.

```
await page.getByTestId('orange').click();

```

获取第 n 项​

🌐 Get by nth item

如果你有一个相同元素的列表，并且唯一能区分它们的方式是顺序，你可以使用 locator.first()、locator.last() 或 locator.nth() 从列表中选择特定元素。

🌐 If you have a list of identical elements, and the only way to distinguish between them is the order, you can choose a specific element from a list with locator.first(), locator.last() or locator.nth().

```
const banana = await page.getByRole('listitem').nth(1);

```

然而，使用这种方法时要小心。很多时候，页面可能会发生变化，而定位器会指向与你预期完全不同的元素。相反，尝试想出一个能够通过严格性标准的唯一定位器。

🌐 However, use this method with caution. Often times, the page might change, and the locator will point to a completely different element from the one you expected. Instead, try to come up with a unique locator that will pass the strictness criteria.

### 链接过滤器​

🌐 Chaining filters

当你有多个具有不同相似性的元素时，可以使用 locator.filter() 方法来选择正确的元素。你还可以链接多个过滤器以缩小选择范围。

🌐 When you have elements with various similarities, you can use the locator.filter() method to select the right one. You can also chain multiple filters to narrow down the selection.

例如，考虑以下 DOM 结构：

🌐 For example, consider the following DOM structure:

http://localhost:3000约翰打招呼玛丽打招呼约翰道别玛丽道别

```
ul>  li>    div>Johndiv>    div>button>Say hellobutton>div>  li>  li>    div>Marydiv>    div>button>Say hellobutton>div>  li>  li>    div>Johndiv>    div>button>Say goodbyebutton>div>  li>  li>    div>Marydiv>    div>button>Say goodbyebutton>div>  li>ul>
```

截取包含“Mary”和“Say goodbye”的那一行的截图：

🌐 To take a screenshot of the row with "Mary" and "Say goodbye":

```
const rowLocator = page.getByRole('listitem');
await rowLocator    .filter({ hasText: 'Mary' })    .filter({ has: page.getByRole('button', { name: 'Say goodbye' }) })    .screenshot({ path: 'screenshot.png' });

```

现在你应该在项目的根目录中有一个“screenshot.png”文件。

🌐 You should now have a "screenshot.png" file in your project's root directory.

### 罕见用例​

🌐 Rare use cases

对列表中的每个元素执行一些操作​

🌐 Do something with each element in the list

迭代元素：

🌐 Iterate elements:

```
for (const row of await page.getByRole('listitem').all())  console.log(await row.textContent());

```

使用常规 for 循环进行迭代：

🌐 Iterate using regular for loop:

```
const rows = page.getByRole('listitem');
const count = await rows.count();
for (let i = 0;
 i  count;
 ++i)  console.log(await rows.nth(i).textContent());

```

在页面中进行评价​

🌐 Evaluate in the page

locator.evaluateAll() 内的代码在页面中运行，你可以在那里调用任何 DOM API。

🌐 The code inside locator.evaluateAll() runs in the page, you can call any DOM apis there.

```
const rows = page.getByRole('listitem');
const texts = await rows.evaluateAll(    list => list.map(element => element.textContent));

```

## 严格​

🌐 Strictness

定位器是严格的。这意味着对定位器的所有操作，如果涉及某个目标 DOM 元素，当有多个元素匹配时将抛出异常。例如，如果 DOM 中有多个按钮，下面的调用将会抛出异常：

🌐 Locators are strict. This means that all operations on locators that imply some target DOM element will throw an exception if more than one element matches. For example, the following call throws if there are several buttons in the DOM:

如果超过一个则抛出错误​

🌐 Throws an error if more than one

```
await page.getByRole('button').click();

```

另一方面，Playwright 可以理解你何时执行多元素操作，因此当定位器解析为多个元素时，以下调用可以正常工作。

🌐 On the other hand, Playwright understands when you perform a multiple-element operation, so the following call works perfectly fine when the locator resolves to multiple elements.

适用于多个元素​

🌐 Works fine with multiple elements

```
await page.getByRole('button').count();

```

你可以通过告诉 Playwright 在多个元素匹配时使用哪个元素来明确选择退出严格性检查，方法是使用 locator.first()、locator.last() 和 locator.nth()。不推荐使用这些方法，因为当你的页面发生变化时，Playwright 可能会点击你不想点击的元素。相反，请遵循上述最佳实践，创建一个唯一标识目标元素的定位器。

🌐 You can explicitly opt-out from strictness check by telling Playwright which element to use when multiple elements match, through locator.first(), locator.last(), and locator.nth(). These methods are not recommended because when your page changes, Playwright may click on an element you did not intend. Instead, follow best practices above to create a locator that uniquely identifies the target element.

## 更多定位器​

🌐 More Locators

对于不常用的定位器，请查看 其他定位器 指南。

🌐 For less commonly used locators, look at the other locators guide.
