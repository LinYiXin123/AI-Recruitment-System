import { test, expect } from "@playwright/test"

test("首页展示完整，体验入口可用且无横向溢出", async ({ page }, testInfo) => {
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  await page.goto("/")
  await expect(page.locator(".container-scroll-card")).toHaveCSS(
    "transform",
    "none"
  )
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "知人善任"
  )
  await expect(
    page.getByRole("heading", { name: "简历分析工作台" })
  ).toBeVisible()
  await page.getByRole("link", { name: "体验简历分析", exact: true }).click()
  await expect(page).toHaveURL(/#demo$/)
  await expect(page.locator(".container-scroll-card")).toHaveCSS(
    "transform",
    "none"
  )
  await expect(page.getByRole("combobox", { name: "选择演示岗位" })).toHaveText(
    "01 · 产品经理"
  )
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  ).toBe(true)
  if (testInfo.project.name === "mobile") {
    const viewport = page.viewportSize()!
    await page.setViewportSize({ width: 320, height: 844 })
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth
      )
    ).toBe(true)
    await page.setViewportSize(viewport)
  }
  await page.goto("/")
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({
    path: `test-results/home-${testInfo.project.name}.png`,
    fullPage: true,
  })
  expect(errors).toEqual([])
})

test("工作台随滚动展平，正常动画下仍可操作且无横向溢出", async ({
  page,
  isMobile,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" })
  await page.goto("/")
  await page.addStyleTag({
    content: "html { scroll-behavior: auto !important; }",
  })
  const card = page.locator(".container-scroll-card")
  expect(
    await card.evaluate((element) => {
      const origin = getComputedStyle(element).transformOrigin.split(" ")
      return (
        Math.abs(
          parseFloat(origin[1]) - (element as HTMLElement).offsetHeight
        ) < 1
      )
    })
  ).toBe(true)
  const tilt = () =>
    card.evaluate((element) =>
      Math.abs(new DOMMatrixReadOnly(getComputedStyle(element).transform).m23)
    )

  await expect.poll(tilt).toBeGreaterThan(0.001)
  // 同时检查窄屏和窗口跨过手机断点后的动画。
  for (const width of isMobile ? [320, 390] : [700, 899, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    await page.evaluate(() => window.scrollTo(0, 0))
    await expect.poll(tilt).toBeGreaterThan(0.001)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth
      )
    ).toBe(true)
  }

  const tab = page.getByRole("combobox", { name: "选择演示岗位" })
  await tab.evaluate((element) => element.focus({ preventScroll: true }))
  await expect.poll(tilt).toBeGreaterThan(0.001)
  await tab.evaluate((element) => element.blur())
  await expect.poll(tilt).toBeGreaterThan(0.001)

  await page.evaluate(() => {
    const top =
      document.querySelector(".container-scroll")!.getBoundingClientRect().top +
      scrollY
    window.scrollTo(0, top - innerHeight * 0.1)
  })
  await expect.poll(tilt).toBeLessThan(0.001)
  await expect
    .poll(() =>
      card.evaluate(
        (element) =>
          new DOMMatrixReadOnly(getComputedStyle(element).transform).a
      )
    )
    .toBeCloseTo(1, 2)
  await tab.click()
  await page
    .getByRole("option", { name: "02 · 前端工程师", exact: true })
    .click()
  await page.getByRole("button", { name: "查看面试建议" }).click()
  await expect(page.getByRole("dialog")).toContainText(
    "首屏优化用了哪些测量工具"
  )
  await page.keyboard.press("Escape")
  await expect(page.getByRole("dialog")).not.toBeVisible()
})

test("28 组示例的头像、岗位与原文依据对应，翻页边界正确", async ({ page }) => {
  await page.goto("/#demo")
  const selector = page.getByRole("combobox", { name: "选择演示岗位" })
  await selector.click()
  const options = await page.getByRole("option").allTextContents()
  expect(options).toHaveLength(28)
  expect(new Set(options).size).toBe(28)
  await page.keyboard.press("Escape")
  await expect(page.getByRole("button", { name: "上一个示例" })).toBeDisabled()
  for (const [index, option] of options.entries()) {
    await selector.click()
    await page.getByRole("option", { name: option, exact: true }).click()
    const number = String(index + 1).padStart(2, "0")
    await expect(
      page.getByRole("heading", { name: `候选人 ${number}`, exact: true })
    ).toBeVisible()
    await expect(page.getByRole("status")).toHaveText(`${number} / 28`)
    await expect(page.locator(".analysis-heading .eyebrow")).toContainText(
      option.split(" · ")[1]
    )
    const avatar = page.locator(".resume-avatar img")
    await expect(avatar).toHaveAttribute("src", `/avatars/${index + 1}.png`)
    await expect
      .poll(() =>
        avatar.evaluate(
          (image: HTMLImageElement) => image.complete && image.naturalWidth > 0
        )
      )
      .toBe(true)
    const source = await page.locator(".resume-highlight").textContent()
    await page
      .getByRole("button", { name: /的简历依据$/ })
      .first()
      .click()
    await expect(page.getByRole("dialog").locator("blockquote")).toHaveText(
      source!
    )
    await page.keyboard.press("Escape")
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth
      )
    ).toBe(true)
  }
  await expect(page.getByRole("button", { name: "下一个示例" })).toBeDisabled()
  await page.getByRole("button", { name: "上一个示例" }).click()
  await expect(page.getByRole("status")).toHaveText("27 / 28")
  await page.getByRole("button", { name: "下一个示例" }).click()
  await page.getByRole("button", { name: "查看面试建议" }).click()
  await expect(page.getByRole("dialog")).toContainText(
    "传播主题被目标用户正确理解"
  )
})

test("切换岗位后依据与面试建议一致，弹窗支持键盘退出", async ({ page }) => {
  await page.goto("/#demo")
  await page.getByRole("combobox", { name: "选择演示岗位" }).click()
  await page
    .getByRole("option", { name: "02 · 前端工程师", exact: true })
    .click()
  await expect(
    page.getByRole("heading", { name: "候选人 02", exact: true })
  ).toBeVisible()
  const sourceButton = page.getByRole("button", {
    name: "查看React 与 TypeScript 实践的简历依据",
  })
  await sourceButton.click()
  const dialog = page.getByRole("dialog")
  await expect(dialog).toContainText(
    "使用 React 与 TypeScript 开发内部业务系统"
  )
  await page.keyboard.press("Escape")
  await expect(dialog).not.toBeVisible()
  await expect(sourceButton).toBeFocused()
  await page.getByRole("button", { name: "查看面试建议" }).click()
  await expect(dialog).toContainText("首屏优化用了哪些测量工具")
  await dialog.getByRole("button", { name: "关闭", exact: true }).click()
  await page.getByRole("combobox", { name: "选择演示岗位" }).click()
  await page.getByRole("option", { name: "01 · 产品经理", exact: true }).click()
  await expect(
    page.getByRole("heading", { name: "候选人 01", exact: true })
  ).toBeVisible()
  await expect(
    page.getByRole("heading", { name: "React 与 TypeScript 实践", exact: true })
  ).not.toBeVisible()
  await page.getByRole("button", { name: "下一个示例" }).focus()
  await page.keyboard.press("Enter")
  await expect(page.getByRole("combobox", { name: "选择演示岗位" })).toHaveText(
    "02 · 前端工程师"
  )
})

test("导航、常见问题与隐私说明可操作", async ({ page, isMobile }) => {
  await page.goto("/")
  if (isMobile) {
    await page.getByLabel("打开导航菜单").click()
    await page
      .getByRole("navigation", { name: "手机导航" })
      .getByRole("link", { name: "常见问题" })
      .click()
    await expect(
      page.getByRole("navigation", { name: "手机导航" })
    ).not.toBeVisible()
  } else {
    await page
      .getByRole("navigation", { name: "主导航" })
      .getByRole("link", { name: "常见问题" })
      .click()
  }
  await expect(page).toHaveURL(/#faq$/)
  await page
    .getByRole("button", { name: "这个页面可以分析我的真实简历吗？" })
    .click()
  await expect(
    page.getByText("真实文件解析与 AI 模型尚未接入", { exact: false })
  ).toBeVisible()
  await page.getByRole("button", { name: "演示与隐私说明" }).click()
  await expect(page.getByRole("dialog")).toContainText("不保存你的演示操作")
  await page.getByRole("button", { name: "关闭", exact: true }).click()
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  ).toBe(true)
})
