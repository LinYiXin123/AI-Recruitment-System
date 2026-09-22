import { test, expect } from "@playwright/test"

test("每两秒淡入淡出轮播，菜单暂停、手动暂停与末页循环可用", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" })
  await page.goto("/")
  await page.addStyleTag({
    content: "html { scroll-behavior: auto !important; }",
  })
  await page.locator("#demo").scrollIntoViewIfNeeded()
  const count = page.locator(".demo-count")
  const started = Date.now()
  await expect(count).toHaveText("01 / 28")
  await expect(count).toHaveText("02 / 28", { timeout: 3000 })
  expect(Date.now() - started).toBeGreaterThan(1500)
  await expect
    .poll(
      () =>
        page
          .locator(".demo-slide")
          .evaluate((el) => Number(getComputedStyle(el).opacity)),
      { intervals: [16] }
    )
    .toBeLessThan(0.99)
  await expect(
    page.getByRole("heading", { name: "候选人 02", exact: true })
  ).toBeVisible()
  await expect(page.locator(".demo-slide")).toHaveCSS("opacity", "1")

  const selector = page.getByRole("combobox", { name: "选择演示岗位" })
  await selector.click()
  const pausedCount = await count.textContent()
  await page.waitForTimeout(2300)
  await expect(count).toHaveText(pausedCount!)
  await page.getByRole("option", { name: "28 · 品牌策划", exact: true }).click()
  await expect(
    page.getByRole("heading", { name: "候选人 28", exact: true })
  ).toBeVisible()
  await page.getByRole("button", { name: "暂停自动轮播" }).click()
  await page.waitForTimeout(2300)
  await expect(count).toHaveText("28 / 28")
  await page.getByRole("button", { name: "开始自动轮播" }).click()
  await expect(count).toHaveText("01 / 28", { timeout: 3000 })
  await expect(
    page.getByRole("heading", { name: "候选人 01", exact: true })
  ).toBeVisible()
  await page.getByRole("button", { name: "查看面试建议" }).click()
  await expect(page.getByRole("dialog")).toBeVisible()
  await page.waitForTimeout(2300)
  await expect(count).toHaveText("01 / 28")
  await expect(page.getByRole("dialog")).toContainText("产品经理 · 面试建议")
})

test("鼠标倾斜与光晕跟随，点击不回正且菜单保留卡片透视", async ({
  page,
  isMobile,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" })
  await page.goto("/")
  await page.addStyleTag({
    content: "html { scroll-behavior: auto !important; }",
  })
  await page.evaluate(() => {
    const top =
      document.querySelector(".container-scroll")!.getBoundingClientRect().top +
      scrollY
    scrollTo(0, top - innerHeight * 0.4)
  })
  const card = page.locator(".container-scroll-card")
  const tilt = () =>
    card.evaluate((el) =>
      Math.abs(new DOMMatrixReadOnly(getComputedStyle(el).transform).m23)
    )
  await expect.poll(tilt).toBeGreaterThan(0.02)
  await expect(card).toHaveCSS("border-top-width", "8px")
  const baseTilt = await tilt()
  const box = (await card.boundingBox())!
  if (isMobile) {
    await expect(page.locator(".pointer-follow-glow")).toHaveCSS(
      "display",
      "none"
    )
  } else {
    await page.mouse.move(
      box.x + box.width * 0.8,
      box.y + Math.min(box.height * 0.4, 250)
    )
    await expect
      .poll(() =>
        card.evaluate((el) =>
          parseFloat(getComputedStyle(el).getPropertyValue("--glow-alpha"))
        )
      )
      .toBeGreaterThan(0.9)
    await expect
      .poll(() =>
        card.evaluate((el) =>
          Math.abs(new DOMMatrixReadOnly(getComputedStyle(el).transform).m31)
        )
      )
      .toBeGreaterThan(0.01)
    const glowX = await card.evaluate((el) =>
      parseFloat(getComputedStyle(el).getPropertyValue("--glow-x"))
    )
    expect(glowX).toBeGreaterThan(65)
    await page.mouse.move(
      box.x + box.width * 0.2,
      box.y + Math.min(box.height * 0.4, 250)
    )
    await expect
      .poll(() =>
        card.evaluate((el) =>
          parseFloat(getComputedStyle(el).getPropertyValue("--glow-x"))
        )
      )
      .toBeLessThan(35)
    await page.mouse.move(1, 1)
    await expect.poll(tilt).toBeCloseTo(baseTilt, 2)
    await expect
      .poll(() =>
        card.evaluate((el) =>
          parseFloat(getComputedStyle(el).getPropertyValue("--glow-alpha"))
        )
      )
      .toBeLessThan(0.01)
  }
  await page.getByRole("button", { name: "下一个示例" }).click()
  await expect.poll(tilt).toBeGreaterThan(0.02)
  await page.getByRole("combobox", { name: "选择演示岗位" }).click()
  const menu = page.locator('[data-slot="select-content"]')
  await expect(menu).toBeVisible()
  expect(
    await menu.evaluate((el) => !!el.closest(".container-scroll-card"))
  ).toBe(true)
  await expect.poll(tilt).toBeGreaterThan(0.02)
  await page.screenshot({
    path: `test-results/demo-tilt-menu-${isMobile ? "mobile" : "desktop"}.png`,
  })
  await page
    .getByRole("option", { name: "04 · 数据分析师", exact: true })
    .click()
  await expect(
    page.getByRole("heading", { name: "候选人 04", exact: true })
  ).toBeVisible()
})
