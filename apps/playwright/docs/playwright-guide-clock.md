---
title: 时钟
source_url: https://playwright.nodejs.cn/docs/clock
fetched_at: 2026-04-29T02:57:28.664Z
---

# 时钟

## 介绍

🌐 Introduction

准确模拟时间相关的行为对于验证应用的正确性至关重要。利用 [Clock](https://playwright.nodejs.cn/docs/api/class-clock "Clock") 功能，开发者可以在测试中操作和控制时间，从而精确验证渲染时间、超时、计划任务等功能，而无需经历真实执行时间的延迟和变化。

🌐 Accurately simulating time-dependent behavior is essential for verifying the correctness of applications. Utilizing [Clock](https://playwright.nodejs.cn/docs/api/class-clock "Clock") functionality allows developers to manipulate and control time within tests, enabling the precise validation of features such as rendering time, timeouts, scheduled tasks without the delays and variability of real-time execution.

[Clock](https://playwright.nodejs.cn/docs/api/class-clock "Clock") API 提供以下方法来控制时间：

🌐 The [Clock](https://playwright.nodejs.cn/docs/api/class-clock "Clock") API provides the following methods to control time:

*   `setFixedTime`：设置 `Date.now()` 和 `new Date()` 的固定时间。
*   `install`：初始化时钟并允许你： 
    *   `pauseAt`：在特定时间暂停时间。
    *   `fastForward`：快进时间。
    *   `runFor`：运行特定持续时间的时间。
    *   `resume`：恢复时间。

*   `setSystemTime`：设置当前系统时间。

推荐的方法是使用 `setFixedTime` 将时间设置为特定值。如果这对你的使用场景不起作用，你可以使用 `install`，它允许你稍后暂停时间、快进时间、滴答时间等。`setSystemTime` 仅推荐用于高级使用场景。

🌐 The recommended approach is to use `setFixedTime` to set the time to a specific value. If that doesn't work for your use case, you can use `install` which allows you to pause time later on, fast forward it, tick it, etc. `setSystemTime` is only recommended for advanced use cases.

note

[page.clock](https://playwright.nodejs.cn/docs/api/class-page#page-clock) 覆盖与时间相关的本地全局类和函数，允许它们被手动控制：

*   `Date`
*   `setTimeout`
*   `clearTimeout`
*   `setInterval`
*   `clearInterval`
*   `requestAnimationFrame`
*   `cancelAnimationFrame`
*   `requestIdleCallback`
*   `cancelIdleCallback`
*   `performance`
*   `Event.timeStamp`：::

warning

如果在测试中的任何时候调用 `install`，该调用 _必须_ 在任何其他与时钟相关的调用之前进行（请参见上面的注释了解列表）。如果调用这些方法的顺序不正确，将导致未定义的行为。例如，你不能先调用 `setInterval`，然后是 `install`，再调用 `clearInterval`，因为 `install` 会覆盖时钟函数的本地定义。

## 使用预定义时间进行测试

🌐 Test with predefined time

通常你只需要伪造 `Date.now`，同时保持计时器运行。这样时间自然流逝，但 `Date.now` 始终返回固定值。

🌐 Often you only need to fake `Date.now` while keeping the timers going. That way the time flows naturally, but `Date.now` always returns a fixed value.

```ts
<div id="current-time" data-testid="current-time"></div><script>  const renderTime = () => {
  document.getElementById('current-time').textContent =        new Date().toLocaleString();  };  setInterval(renderTime, 1000);
</script>
```

```ts
await page.clock.setFixedTime(new Date('2024-02-02T10:00:00'));
await page.goto('http://localhost:3333');
await expect(page.getByTestId('current-time')).toHaveText('2/2/2024, 10:00:00 AM');
await page.clock.setFixedTime(new Date('2024-02-02T10:30:00'));
// We know that the page has a timer that updates the time every second.await expect(page.getByTestId('current-time')).toHaveText('2/2/2024, 10:30:00 AM');
```

## 一致的时间和计时器

🌐 Consistent time and timers

有时你的计时器依赖于 `Date.now`，当 `Date.now` 的值随时间不变化时会感到困惑。在这种情况下，你可以安装时钟，并在测试时快进到感兴趣的时间。

🌐 Sometimes your timers depend on `Date.now` and are confused when the `Date.now` value does not change over time. In this case, you can install the clock and fast forward to the time of interest when testing.

```ts
<div id="current-time" data-testid="current-time"></div><script>  const renderTime = () => {
  document.getElementById('current-time').textContent =        new Date().toLocaleString();  };  setInterval(renderTime, 1000);
</script>
```

```ts
// Initialize clock with some time before the test time and let the page load// naturally. `Date.now` will progress as the timers fire.await page.clock.install({ time: new Date('2024-02-02T08:00:00') });
await page.goto('http://localhost:3333');
// Pretend that the user closed the laptop lid and opened it again at 10am,// Pause the time once reached that point.await page.clock.pauseAt(new Date('2024-02-02T10:00:00'));
// Assert the page state.await expect(page.getByTestId('current-time')).toHaveText('2/2/2024, 10:00:00 AM');
// Close the laptop lid again and open it at 10:30am.await page.clock.fastForward('30:00');
await expect(page.getByTestId('current-time')).toHaveText('2/2/2024, 10:30:00 AM');
```

## 测试不活动监控

🌐 Test inactivity monitoring

不活动监控是网页应用中的一个常见功能，它会在用户长时间不活动后将其登出。测试这个功能可能有些棘手，因为你需要等待很长时间才能看到效果。借助时钟，你可以加快时间，从而快速测试这个功能。

🌐 Inactivity monitoring is a common feature in web applications that logs out users after a period of inactivity. Testing this feature can be tricky because you need to wait for a long time to see the effect. With the help of the clock, you can speed up time and test this feature quickly.

```ts
<div id="remaining-time" data-testid="remaining-time"></div><script>  const endTime = Date.now() + 5 * 60_000;  const renderTime = () => {
  const diffInSeconds = Math.round((endTime - Date.now()) / 1000);    if (diffInSeconds <= 0) {
  document.getElementById('remaining-time').textContent =        'You have been logged out due to inactivity.';    } else {
  document.getElementById('remaining-time').textContent =        `You will be logged out in ${diffInSeconds} seconds.`;    }    setTimeout(renderTime, 1000);  };  renderTime();
</script><button type="button">Interaction</button>
```

```ts
// Initial time does not matter for the test, so we can pick current time.await page.clock.install();
await page.goto('http://localhost:3333');
// Interact with the pageawait page.getByRole('button').click();
// Fast forward time 5 minutes as if the user did not do anything.// Fast forward is like closing the laptop lid and opening it after 5 minutes.// All the timers due will fire once immediately, as in the real browser.await page.clock.fastForward('05:00');
// Check that the user was logged out automatically.await expect(page.getByText('You have been logged out due to inactivity.')).toBeVisible();
```

## 手动计时，持续触发所有计时器

🌐 Tick through time manually, firing all the timers consistently

在极少数情况下，你可能希望手动计时，在此过程中触发所有计时器和动画帧，以实现对时间流逝的细粒度控制。

🌐 In rare cases, you may want to tick through time manually, firing all timers and animation frames in the process to achieve a fine-grained control over the passage of time.

```ts
<div id="current-time" data-testid="current-time"></div><script>  const renderTime = () => {
  document.getElementById('current-time').textContent =        new Date().toLocaleString();  };  setInterval(renderTime, 1000);
</script>
```

```ts
// Initialize clock with a specific time, let the page load naturally.await page.clock.install({ time: new Date('2024-02-02T08:00:00') });
await page.goto('http://localhost:3333');
// Pause the time flow, stop the timers, you now have manual control// over the page time.await page.clock.pauseAt(new Date('2024-02-02T10:00:00'));
await expect(page.getByTestId('current-time')).toHaveText('2/2/2024, 10:00:00 AM');
// Tick through time manually, firing all timers in the process.// In this case, time will be updated in the screen 2 times.await page.clock.runFor(2000);
await expect(page.getByTestId('current-time')).toHaveText('2/2/2024, 10:00:02 AM');
```

🌐 Related Videos
