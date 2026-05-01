---
title: Untitled
source_url: https://playwright.nodejs.cn/docs/other-locators
fetched_at: 2026-04-29T02:57:28.664Z
---

# Untitled

- 指南其他定位器On this page其他定位器 ## 介绍​ 🌐 Introduction note查看主要的定位器指南，了解最常用和推荐的定位器。🌐 Check out the main locators guide for most common and recommended locators. 除了推荐的定位器，如 page.getByRole() 和 page.getByText() 外，Playwright 还支持本指南中描述的各种其他定位器。 🌐 In addition to recommended locators like page.getByRole() and page.getByText(), Playwright supports a variety of other locators described in this guide. ## CSS 定位器​ 🌐 CSS locator note我们建议优先使用用户可见的定位器，例如文本或可访问角色，而不是使用与实现绑定且在页面更改时可能会破坏的 CSS。🌐 We recommend prioritizing user-visible locators like text or accessible role instead of using CSS that is tied to the implementation and could break when the page changes. Playwright 可以通过 CSS 选择器来定位元素。 🌐 Playwright can locate an element by CSS selector. ``` await page.locator('css=button').click(); ``` Playwright 通过两种方式增强标准 CSS 选择器： 🌐 Playwright augments standard CSS selectors in two ways: CSS 选择器刺穿开放的影子 DOM。

- Playwright 添加了自定义伪类，例如 :visible、:has-text()、:has()、:is()、:nth-match() 等。

### CSS：按文本匹配​

🌐 CSS: matching by text

Playwright 包含许多 CSS 伪类，用于根据文本内容来匹配元素。

🌐 Playwright include a number of CSS pseudo-classes to match elements by their text content.

- article:has-text("Playwright") - :has-text() 会匹配包含指定文本的任何元素，这些文本可能位于子元素或后代元素中。匹配不区分大小写，会去除空白字符，并搜索子字符串。 例如，article:has-text("Playwright") 匹配 Playwright。 请注意，:has-text() 应与其他 CSS 指定符一起使用，否则它将匹配所有包含指定文本的元素，包括 。 ``` // Wrong, will match many elements including await page.locator(':has-text("Playwright")').click(); // Correct, only matches the elementawait page.locator('article:has-text("Playwright")').click(); ```

- #nav-bar :text("Home") - :text() 伪类匹配包含指定文本的最小元素。匹配不区分大小写，会去除空白，并搜索子字符串。 例如，这将会在 #nav-bar 元素内部的某个位置找到文本为“Home”的元素： ``` await page.locator('#nav-bar :text("Home")').click(); ```

- #nav-bar :text-is("Home") - :text-is() 伪类匹配具有精确文本的最小元素。精确匹配区分大小写，会去除空白，并搜索整个字符串。 例如，:text-is("Log") 不匹配 Log in，因为  包含一个文本节点 "Log in"，它不等于 "Log"。然而，:text-is("Log") 匹配  Log in，因为  包含一个文本节点 " Log "。 同样地，:text-is("Download") 不会匹配 download，因为它区分大小写。

- #nav-bar :text-matches("reg?ex", "i") - :text-matches() 伪类匹配文本内容符合 JavaScript 类正则表达式 的最小元素。 例如，:text-matches("Log\s*in", "i") 匹配 Login 和 log IN。

note文本匹配总是会规范化空白。例如，它会将多个空格合并为一个，将换行符转换为空格，并忽略开头和结尾的空白。🌐 Text matching always normalizes whitespace. For example, it turns multiple spaces into one, turns line breaks into spaces and ignores leading and trailing whitespace. note类型为 button 和 submit 的输入元素是通过它们的 value 匹配的，而不是文本内容。例如，:text("Log in") 匹配 。 ### CSS：仅匹配可见元素​ 🌐 CSS: matching only visible elements

Playwright 支持 CSS 选择器中的 :visible 伪类。例如，css=button 匹配页面上的所有按钮，而 css=button:visible 仅匹配可见按钮。这对于区分非常相似但在可见性上有所不同的元素非常有用。

🌐 Playwright supports the :visible pseudo class in CSS selectors. For example, css=button matches all the buttons on the page, while css=button:visible only matches visible buttons. This is useful to distinguish elements that are very similar but differ in visibility.

考虑一个带有两个按钮的页面，第一个按钮不可见，第二个按钮可见。

🌐 Consider a page with two buttons, first invisible and second visible.

```
button style='display: none'>Invisiblebutton>button>Visiblebutton>
```

- 这将找到两个按钮并抛出一个 strictness 违规错误： ``` await page.locator('button').click(); ```

- 这只会找到第二个按钮，因为它是可见的，然后单击它。 ``` await page.locator('button:visible').click(); ```

### CSS：包含其他元素的元素​

🌐 CSS: elements that contain other elements

:has() 伪类是一个实验性的 CSS 伪类。如果相对于给定元素的 :scope 的任何作为参数传入的选择器匹配至少一个元素，它将返回该元素。

🌐 The :has() pseudo-class is an experimental CSS pseudo-class. It returns an element if any of the selectors passed as parameters relative to the :scope of the given element match at least one element.

以下代码片段返回包含  的  元素的文本内容。

🌐 Following snippet returns text content of an  element that has a  inside.

```
await page.locator('article:has(div.promo)').textContent();

```

### CSS：匹配任一条件的元素​

🌐 CSS: elements matching one of the conditions

以逗号分隔的 CSS 选择器列表将匹配可由该列表中的选择器之一选择的所有元素。

🌐 Comma-separated list of CSS selectors will match all elements that can be selected by one of the selectors in that list.

```
// Clicks a  that has either a "Log in" or "Sign in" text.await page.locator('button:has-text("Log in"), button:has-text("Sign in")').click();

```

:is() 伪类是一个实验性 CSS 伪类，可能对于在元素上指定一系列额外条件非常有用。

🌐 The :is() pseudo-class is an experimental CSS pseudo-class that may be useful for specifying a list of extra conditions on an element.

### CSS：基于布局匹配元素​

🌐 CSS: matching elements based on layout

warning布局选择器已被弃用，并可能在未来被移除。基于布局的匹配可能会产生意外的结果。例如，当布局发生一像素的变化时，可能会匹配到不同的元素。🌐 Layout selectors are deprecated and may be removed in the future. Matching based on layout may produce unexpected results. For example, a different element could be matched when layout changes by one pixel.我们建议优先使用 用户可见定位器。🌐 We recommend prioritizing user-visible locators instead. 有时候，当目标元素缺乏明显特性时，很难想出一个好的选择器。在这种情况下，使用 Playwright 的布局 CSS 伪类可能会有帮助。这些伪类可以与常规 CSS 结合使用，以精确定位多个选项中的某一个。

🌐 Sometimes, it is hard to come up with a good selector to the target element when it lacks distinctive features. In this case, using Playwright layout CSS pseudo-classes could help. These can be combined with regular CSS to pinpoint one of the multiple choices.

例如，input:right-of(:text("Password")) 匹配位于“密码”文本右侧的输入字段——当页面上有多个难以区分的输入框时，这非常有用。

🌐 For example, input:right-of(:text("Password")) matches an input field that is to the right of text "Password" - useful when the page has multiple inputs that are hard to distinguish between each other.

注意，布局伪类除了其他功能外，比如“input”也很有用。如果你只用一个布局伪类，比如“:right-of(:text("Password"))”，很可能得到的不是你想要的输入，而是文本和目标输入之间某个空元素。

🌐 Note that layout pseudo-classes are useful in addition to something else, like input. If you use a layout pseudo-class alone, like :right-of(:text("Password")), most likely you'll get not the input you are looking for, but some empty element in between the text and the target input.

布局伪类使用边界客户端矩形来计算元素的距离和相对位置。

🌐 Layout pseudo-classes use bounding client rect to compute distance and relative position of the elements.

- :right-of(div > button) - 匹配位于任何匹配内部选择器的元素右侧的元素，无论其垂直位置如何。

- :left-of(div > button) - 匹配位于任何与内部选择器匹配的元素左侧的元素，且可以在任意垂直位置。

- :above(div > button) - 匹配位于任意水平位置上，位于任何与内层选择器匹配元素之上的元素。

- :below(div > button) - 匹配位于匹配内部选择器的任何元素下方的元素，无论水平位置如何。

- :near(div > button) - 匹配靠近（在50个CSS像素范围内）与内部选择器匹配的任何元素的元素。

请注意，结果匹配项是按与锚元素的距离排序的，因此你可以使用 locator.first() 来选择最近的一个。这只有在你有类似元素列表的情况下才有用，因为最近的那个显然是正确的。然而，在其他情况下使用 locator.first() 很可能不会按预期工作——它不会定位你要寻找的元素，而是定位恰好最近的其他元素，比如一个随机的空 ，或者一个已经滚动出视图且当前不可见的元素。

🌐 Note that resulting matches are sorted by their distance to the anchor element, so you can use locator.first() to pick the closest one. This is only useful if you have something like a list of similar elements, where the closest is obviously the right one. However, using locator.first() in other cases most likely won't work as expected - it will not target the element you are searching for, but some other element that happens to be the closest like a random empty , or an element that is scrolled out and is not currently visible.

```
// Fill an input to the right of "Username".await page.locator('input:right-of(:text("Username"))').fill('value');
// Click a button near the promo card.await page.locator('button:near(.promo-card)').click();
// Click the radio input in the list closest to the "Label 3".await page.locator('[type=radio]:left-of(:text("Label 3"))').first().click();

```

所有布局伪类都支持将可选的最大像素距离作为最后一个参数。例如，button:near(:text("Username"), 120) 匹配距离文本为“Username”的元素最多 120 CSS 像素的按钮。

🌐 All layout pseudo-classes support optional maximum pixel distance as the last argument. For example button:near(:text("Username"), 120) matches a button that is at most 120 CSS pixels away from the element with the text "Username".

### CSS：从查询结果中选择第 n 个匹配项​

🌐 CSS: pick n-th match from the query result

note通常可以通过某些属性或文本内容来区分元素，这对应对页面变化更具韧性。🌐 It is usually possible to distinguish elements by some attribute or text content, which is more resilient to page changes. 有时页面包含许多相似的元素，很难选择其中的某一个。例如：

🌐 Sometimes page contains a number of similar elements, and it is hard to select a particular one. For example:

```
section> button>Buybutton> section>article>div> button>Buybutton> div>article>div>div> button>Buybutton> div>div>
```

在这种情况下，:nth-match(:text("Buy"), 3) 将从上面的代码片段中选择第三个按钮。请注意，索引是从1开始的。

🌐 In this case, :nth-match(:text("Buy"), 3) will select the third button from the snippet above. Note that index is one-based.

```
// Click the third "Buy" buttonawait page.locator(':nth-match(:text("Buy"), 3)').click();

```

:nth-match() 也可以用来等待直到出现指定数量的元素，可以使用 locator.waitFor()。

```
// Wait until all three buttons are visibleawait page.locator(':nth-match(:text("Buy"), 3)').waitFor();

```

note与 :nth-child() 不同，元素不必是同级，它们可以出现在页面的任何位置。在上面的代码片段中，所有三个按钮都匹配 :text("Buy") 选择器，而 :nth-match() 选择第三个按钮。 ## 第 N 个元素定位器​ 🌐 N-th element locator

你可以使用 nth= 定位器通过传入从零开始的索引，将查询缩小到第 n 个匹配项。

🌐 You can narrow down query to the n-th match using the nth= locator passing a zero-based index.

```
// Click first buttonawait page.locator('button').locator('nth=0').click();
// Click last buttonawait page.locator('button').locator('nth=-1').click();

```

## 父元素定位器​

🌐 Parent element locator

当你需要定位某个元素的父元素时，大多数情况下你应该通过子元素定位器使用 locator.filter()。例如，考虑以下 DOM 结构：

🌐 When you need to target a parent element of some other element, most of the time you should locator.filter() by the child locator. For example, consider the following DOM structure:

```
li>label>Hellolabel>li>li>label>Worldlabel>li>
```

如果你想定位文本为 "Hello" 的标签的父元素 ，使用 locator.filter() 效果最好：

🌐 If you'd like to target the parent  of a label with text "Hello", using locator.filter() works best:

```
const child = page.getByText('Hello');
const parent = page.getByRole('listitem').filter({ has: child });

```

或者，如果你找不到父元素的合适定位器，可以使用 xpath=..。请注意，这种方法不如前者可靠，因为任何对 DOM 结构的更改都可能导致测试失败。尽可能优先使用 locator.filter()。

🌐 Alternatively, if you cannot find a suitable locator for the parent element, use xpath=... Note that this method is not as reliable, because any changes to the DOM structure will break your tests. Prefer locator.filter() when possible.

```
const parent = page.getByText('Hello').locator('xpath=..');

```

## React 定位器​

🌐 React locator

noteReact 定位器是实验性的，其前缀为 _。功能可能在未来发生变化。🌐 React locator is experimental and prefixed with _. The functionality might change in future. React 定位器允许通过组件名称和属性值查找元素。其语法与 CSS 属性选择器 非常相似，并支持所有 CSS 属性选择器操作符。

🌐 React locator allows finding elements by their component name and property values. The syntax is very similar to CSS attribute selectors and supports all CSS attribute selector operators.

在 React 定位器中，组件名称采用 驼峰式。

🌐 In React locator, component names are transcribed with CamelCase.

```
await page.locator('_react=BookItem').click();

```

更多示例：

🌐 More examples:

- 按组件匹配：_react=BookItem

- 按组件和精确属性值匹配，区分大小写：_react=BookItem[author = "Steven King"]

- 仅按属性值匹配，不区分大小写：_react=[author = "steven king" i]

- 按组件和真值属性值匹配：_react=MyButton[enabled]

- 按组件和布尔值匹配：_react=MyButton[enabled = false]

- 按属性值子字符串匹配：_react=[author *= "King"]

- 按组件和多个属性匹配：_react=BookItem[author *= "king" i][year = 1990]

- 按 嵌套 属性值匹配：_react=[some.nested.value = 12]

- 按组件和属性值匹配 前缀：_react=BookItem[author ^= "Steven"]

- 按组件和属性值后缀匹配：_react=BookItem[author $= "Steven"]

- 按组件和密钥匹配：_react=BookItem[key = '2']

- 按属性值匹配 正则表达式：_react=[author = /Steven(\\s+King)?/i]

要在树中查找 React 元素名称，请使用 React 开发者工具。

🌐 To find React element names in a tree use React DevTools.

noteReact 定位器支持 React 15 及以上版本。:::🌐 React locator supports React 15 and above. noteReact 定位器以及 React 开发者工具 仅适用于 未压缩 的应用构建。 ## Vue 定位器​ 🌐 Vue locator

noteVue 定位器是实验性的，其前缀为 _。功能可能在未来发生变化。 🌐 Vue locator is experimental and prefixed with _. The functionality might change in future. :::

Vue 定位器允许通过组件名称和属性值查找元素。其语法与 CSS 属性选择器 非常相似，并支持所有 CSS 属性选择器操作符。

🌐 Vue locator allows finding elements by their component name and property values. The syntax is very similar to CSS attribute selectors and supports all CSS attribute selector operators.

在 Vue 定位器中，组件名称使用 kebab-case。

🌐 In Vue locator, component names are transcribed with kebab-case.

```
await page.locator('_vue=book-item').click();

```

更多示例：

🌐 More examples:

- 按组件匹配：_vue=book-item

- 按组件和精确属性值匹配，区分大小写：_vue=book-item[author = "Steven King"]

- 仅按属性值匹配，不区分大小写：_vue=[author = "steven king" i]

- 按组件和真值属性值匹配：_vue=my-button[enabled]

- 按组件和布尔值匹配：_vue=my-button[enabled = false]

- 按属性值子字符串匹配：_vue=[author *= "King"]

- 按组件和多个属性匹配：_vue=book-item[author *= "king" i][year = 1990]

- 按 嵌套 属性值匹配：_vue=[some.nested.value = 12]

- 按组件和属性值 前缀 匹配：_vue=book-item[author ^= "Steven"]

- 按组件和属性值后缀匹配：_vue=book-item[author $= "Steven"]

- 按属性值匹配 正则表达式：_vue=[author = /Steven(\\s+King)?/i]

要在树中查找 Vue 元素名称，请使用 [Vue DevTools](https://chrome.google.com/webstore/detail/vuejs-devtools/nhdogjmejiglipccpnnnanhbledajbpd?hl=en)。

🌐 To find Vue element names in a tree use [Vue DevTools](https://chrome.google.com/webstore/detail/vuejs-devtools/nhdogjmejiglipccpnnnanhbledajbpd?hl=en).

noteVue 定位器支持 Vue2 及以上版本。🌐 Vue locator supports Vue2 and above. noteVue 定位器以及 Vue DevTools 仅能用于 未压缩 的应用构建。 ## XPath 定位器​ 🌐 XPath locator

warning我们建议优先使用用户可见的定位器，例如文本或可访问角色，而不是使用与实现绑定且在页面更改时容易中断的 XPath。🌐 We recommend prioritizing user-visible locators like text or accessible role instead of using XPath that is tied to the implementation and easily break when the page changes. XPath 定位器等同于调用 Document.evaluate。

🌐 XPath locators are equivalent to calling Document.evaluate.

```
await page.locator('xpath=//button').click();

```

note任何以 // 或 .. 开头的选择器字符串都被认为是 xpath 选择器。例如，Playwright 会将 '//html/body' 转换为 'xpath=//html/body'。 noteXPath 不会穿透影子根。 ### XPath 联合​ 🌐 XPath union

管道操作符 (|) 可用于在 XPath 中指定多个选择器。它将匹配列表中任意一个选择器可以选中的所有元素。

🌐 Pipe operator (|) can be used to specify multiple selectors in XPath. It will match all elements that can be selected by one of the selectors in that list.

```
// Waits for either confirmation dialog or load spinner.await page.locator(    `//span[contains(@class, 'spinner__loading')]|//div[@id='confirmation']`).waitFor();

```

## 标签到表单控件重定向​

🌐 Label to form control retargeting

warning我们建议通过标签文本定位，而不是依赖标签到控件的重新定位。🌐 We recommend locating by label text instead of relying to label-to-control retargeting. Playwright 中的目标输入操作会自动区分标签和控件，因此你可以定位标签以对关联的控件执行操作。

🌐 Targeted input actions in Playwright automatically distinguish between labels and controls, so you can target the label to perform an action on the associated control.

例如，考虑以下 DOM 结构：Password:。你可以使用 page.getByText() 根据“密码”文本来定位标签。然而，以下操作将会在输入框上执行，而不是在标签上：

- locator.click() 将点击标签并自动聚焦输入字段；

- locator.fill() 将填写输入字段；

- locator.inputValue() 将返回输入字段的值；

- locator.selectText() 将会选择输入字段中的文本；

- locator.setInputFiles() 将为 type=file 的输入字段设置文件；

- locator.selectOption() 将从下拉框中选择一个选项。

```
// Fill the input by targeting the label.await page.getByText('Password').fill('secret');

```

然而，其他方法将针对标签本身，例如 expect(locator).toHaveText() 将断言标签的文本内容，而不是输入字段。

🌐 However, other methods will target the label itself, for example expect(locator).toHaveText() will assert the text content of the label, not the input field.

```
// Fill the input by targeting the label.await expect(page.locator('label')).toHaveText('Password');

```

## 旧版文本定位器​

🌐 Legacy text locator

warning我们建议改用现代的 文本定位器。🌐 We recommend the modern text locator instead. 旧版文本定位器匹配包含传递文本的元素。

🌐 Legacy text locator matches elements that contain passed text.

```
await page.locator('text=Log in').click();

```

旧版文本定位器有一些变体：

🌐 Legacy text locator has a few variations:

- text=Log in - 默认匹配不区分大小写，会去掉空白字符，并搜索子字符串。例如，text=Log 匹配 Log in。 ``` await page.locator('text=Log in').click(); ```

- text="Log in" - 文本主体可以用单引号或双引号转义，以搜索在去除空格后内容完全匹配的文本节点。 例如，text="Log" 不匹配 Log in，因为  包含一个文本节点 "Log in"，它不等于 "Log"。然而，text="Log" 匹配  Log in，因为  包含一个文本节点 " Log "。这种精确模式意味着区分大小写匹配，所以 text="Download" 不会匹配 download。 引用的内容遵循通常的转义规则，例如，在双引号字符串中使用 \" 来转义双引号：text="foo\"bar"。 ``` await page.locator('text="Log in"').click(); ```

- /Log\s*in/i - 正文可以是用 / 符号封装的类似 JavaScript 的正则表达式（JavaScript-like regex）。例如，text=/Log\s*in/i 可以匹配 Login 和 log IN。 ``` await page.locator('text=/Log\\s*in/i').click(); ```

note以引号开头和结尾的字符串选择器（无论是 " 还是 '）被认为是旧版文本定位器。例如，"Log in" 在内部会被转换为 text="Log in"。 🌐 String selectors starting and ending with a quote (either " or ') are assumed to be a legacy text locators. For example, "Log in" is converted to text="Log in" internally. :::

note匹配总是会规范化空白。例如，它会将多个空格变成一个，将换行符变为空格，并忽略开头和结尾的空白。 note类型为 button 和 submit 的输入元素是通过它们的 value 来匹配的，而不是文本内容。例如，text=Log in 匹配 。 ## id, data-testid, data-test-id, data-test 选择器​ 🌐 id, data-testid, data-test-id, data-test selectors

warning我们建议改为通过测试 ID 定位。🌐 We recommend locating by test id instead. Playwright 支持使用某些属性来快速选择元素。目前，仅支持以下属性：

🌐 Playwright supports shorthand for selecting elements using certain attributes. Currently, only the following attributes are supported:

- id

- data-testid

- data-test-id

- data-test

```
// Fill an input with the id "username"await page.locator('id=username').fill('value');
// Click an element with data-test-id "submit"await page.locator('data-test-id=submit').click();

```

note属性选择器不是 CSS 选择器，因此任何 CSS 特有的内容如 :enabled 都不被支持。要使用更多功能，请使用合适的 css 选择器，例如 css=[data-test="login"]:enabled。 ## 链接选择器​ 🌐 Chaining selectors

warning我们建议改为链式定位器。🌐 We recommend chaining locators instead. 定义为 engine=body 或简写形式的选择器可以与 >> 令牌组合，例如 selector1 >> selector2 >> selectors3。当选择器被链式连接时，下一个选择器是相对于上一个选择器的结果进行查询的。

🌐 Selectors defined as engine=body or in short-form can be combined with the >> token, e.g. selector1 >> selector2 >> selectors3. When selectors are chained, the next one is queried relative to the previous one's result.

例如，

🌐 For example,

```
css=article >> css=.bar > .baz >> css=span[attr=value]
```

相当于

🌐 is equivalent to

```
document    .querySelector('article')    .querySelector('.bar > .baz')    .querySelector('span[attr=value]');

```

如果选择器需要在主体中包含 >>，应将其在字符串内进行转义，以免与链式分隔符混淆，例如 text="some >> text"。

🌐 If a selector needs to include >> in the body, it should be escaped inside a string to not be confused with chaining separator, e.g. text="some >> text".

### 中间匹配​

🌐 Intermediate matches

warning我们建议通过其他定位器筛选以定位包含其他元素的元素。🌐 We recommend filtering by another locator to locate elements that contain other elements. 默认情况下，链式选择器会解析为最后一个选择器查询到的元素。选择器可以加上 * 前缀，以捕获由中间选择器查询到的元素。

🌐 By default, chained selectors resolve to an element queried by the last selector. A selector can be prefixed with * to capture elements that are queried by an intermediate selector.

例如，css=article >> text=Hello 捕获文本为 Hello 的元素，而 *css=article >> text=Hello（注意 *）则捕获包含某个文本为 Hello 元素的 article 元素。

🌐 For example, css=article >> text=Hello captures the element with the text Hello, and *css=article >> text=Hello (note the *) captures the article element that contains some element with the text Hello.
