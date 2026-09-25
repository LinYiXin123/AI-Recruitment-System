import { expect, test } from "@playwright/test"

test("三个能力示意区的蓝色光晕跟随鼠标，移开后淡出且不改变布局", async ({
  page,
  isMobile,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: "no-preference" })
  if (!isMobile) await page.setViewportSize({ width: 713, height: 765 })
  await page.goto("/#features")
  await page.addStyleTag({
    content: "html { scroll-behavior: auto !important; }",
  })
  const cards = page.locator("#features .feature-visual.spotlight-card")
  await expect(cards).toHaveCount(3)
  for (const [index, order] of ["01", "02", "03"].entries()) {
    await expect(cards.nth(index)).toHaveClass(
      new RegExp(`feature-visual--cycle-${order}`)
    )
  }
  const labels = ["岗位需求", "来源：工作经历", "你在这个项目中的贡献吗？"]
  for (let index = 0; index < 3; index++) {
    const card = cards.nth(index)
    await expect(card).toContainText(labels[index])
    await card.evaluate((el) =>
      el.scrollIntoView({ block: "center", behavior: "instant" })
    )
    await expect(page.locator("#features .feature-item").nth(index)).toHaveCSS(
      "transform",
      "none"
    )
    const before = await card.boundingBox()
    await page.mouse.move(before!.x + 20, before!.y + 24)
    await expect(card).toHaveAttribute("data-glow-active", "true")
    await expect
      .poll(() =>
        card.evaluate((el) => Number(getComputedStyle(el, "::after").opacity))
      )
      .toBe(1)
    expect(
      await card.evaluate((el) =>
        parseFloat(el.style.getPropertyValue("--spotlight-x"))
      )
    ).toBeCloseTo(20, 0)
    const firstX = await card.evaluate((el) =>
      el.style.getPropertyValue("--spotlight-x")
    )
    await page.mouse.move(before!.x + before!.width - 20, before!.y + 80)
    expect(
      await card.evaluate((el) => el.style.getPropertyValue("--spotlight-x"))
    ).not.toBe(firstX)
    expect(await card.boundingBox()).toEqual(before)
    expect(
      await card.evaluate((el) =>
        getComputedStyle(el).getPropertyValue("--spotlight-color").trim()
      )
    ).toBe("#2456b8")
    await page.screenshot({
      path: testInfo.outputPath(`光晕-${index + 1}.png`),
    })
    await page.mouse.move(1, 1)
    await expect(card).not.toHaveAttribute("data-glow-active", "true")
    await expect
      .poll(() =>
        card.evaluate((el) => Number(getComputedStyle(el, "::after").opacity))
      )
      .toBe(0)
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true)
})

test("一束光从左向右依次流过三张能力卡片", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" })
  await page.goto("/#features")
  const cards = page.locator("#features .feature-visual.spotlight-card")
  await cards.first().scrollIntoViewIfNeeded()

  const focusState = async () =>
    cards.evaluateAll((elements) =>
      elements.map((element) => ({
        animationDelay: getComputedStyle(element).animationDelay,
      }))
    )

  await expect.poll(focusState).toEqual([
    expect.objectContaining({ animationDelay: "0s" }),
    expect.objectContaining({ animationDelay: "2.1s" }),
    expect.objectContaining({ animationDelay: "4.2s" }),
  ])

  const flowX = () =>
    cards.first().evaluate((element) =>
      Number.parseFloat(
        getComputedStyle(element).getPropertyValue("--feature-flow-x")
      )
    )
  await page.waitForTimeout(240)
  const firstX = await flowX()
  await page.waitForTimeout(420)
  expect(await flowX()).toBeGreaterThan(firstX)

  await expect
    .poll(() =>
      cards.evaluateAll((elements) =>
        elements.map((element) =>
          Number(getComputedStyle(element, "::after").opacity)
        )
      )
    )
    .toEqual([1, 0, 0])

  await page.waitForTimeout(1900)
  await expect
    .poll(() =>
      cards.evaluateAll((elements) =>
        elements.map((element) =>
          Number(getComputedStyle(element, "::after").opacity)
        )
      )
    )
    .toEqual([0, 1, 0])

  await page.waitForTimeout(2100)
  await expect
    .poll(() =>
      cards.evaluateAll((elements) =>
        elements.map((element) =>
          Number(getComputedStyle(element, "::after").opacity)
        )
      )
    )
    .toEqual([0, 0, 1])
})

test("减少动态时保留静止光晕，手机在卡片上滑动仍能向下浏览", async ({
  page,
  isMobile,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" })
  await page.goto("/#features")
  const cards = page.locator("#features .feature-visual")
  const card = cards.first()
  await card.scrollIntoViewIfNeeded()
  for (const item of await cards.all()) {
    await expect(item).toHaveCSS("animation-name", "none")
  }
  await card.hover({ position: { x: 15, y: 20 } })
  const gradient = await card.evaluate(
    (el) => getComputedStyle(el, "::before").backgroundImage
  )
  await card.hover({ position: { x: 100, y: 75 } })
  expect(
    await card.evaluate(
      (el) => getComputedStyle(el, "::before").backgroundImage
    )
  ).toBe(gradient)
  await expect(card).toHaveCSS("touch-action", "auto")
  if (isMobile) {
    const client = await page.context().newCDPSession(page)
    const rect = await card.boundingBox()
    const before = await page.evaluate(() => scrollY)
    const x = rect!.x + rect!.width / 2
    const y = rect!.y + rect!.height / 2
    await client.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x, y }],
    })
    await expect(card).toHaveAttribute("data-glow-active", "true")
    for (let step = 1; step <= 6; step++) {
      await client.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x, y: y - step * 20 }],
      })
      await page.waitForTimeout(16)
    }
    await client.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    })
    await expect
      .poll(() => page.evaluate(() => scrollY))
      .toBeGreaterThan(before + 40)
    await expect(card).not.toHaveAttribute("data-glow-active", "true")
    await client.detach()
  }
})
