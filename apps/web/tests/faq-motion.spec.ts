import { expect, test, type Locator } from "@playwright/test"

const appearance = (locator: Locator) =>
  locator.evaluate((el) => {
    const style = getComputedStyle(el)
    return {
      opacity: Number(style.opacity),
      x: new DOMMatrixReadOnly(style.transform).m41,
    }
  })

const expectShown = async (locator: Locator) => {
  await expect.poll(() => appearance(locator)).toEqual({ opacity: 1, x: 0 })
}

test("头像从左侧淡入，问题从右侧错峰淡入，重新滚入可重播", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" })
  await page.goto("/")
  await page.addStyleTag({
    content: "html { scroll-behavior: auto !important; }",
  })
  const orbit = page.locator(".faq-orbit")
  const questions = page.locator('.faq-list [data-slot="accordion-item"]')
  await expect(questions).toHaveCount(4)
  await expect.poll(() => appearance(orbit)).toMatchObject({ opacity: 0 })
  expect((await appearance(orbit)).x).toBeLessThan(0)
  for (const question of await questions.all()) {
    expect((await appearance(question)).opacity).toBe(0)
    expect((await appearance(question)).x).toBeGreaterThan(0)
  }

  await orbit.evaluate((el) => el.scrollIntoView({ block: "center" }))
  await expectShown(orbit)

  // 手机上先看头像，再滚动到问题；回顶部确保四条问题从同一初始状态入场。
  await page.evaluate(() => scrollTo(0, 0))
  await expect
    .poll(() => appearance(questions.first()))
    .toMatchObject({ opacity: 0 })
  const frames = await page.locator(".faq-list").evaluate(async (el) => {
    const samples: { opacity: number; x: number }[][] = []
    el.scrollIntoView({ block: "center" })
    const start = performance.now()
    while (performance.now() - start < 1400) {
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve())
      )
      samples.push(
        [...el.querySelectorAll('[data-slot="accordion-item"]')].map((item) => {
          const style = getComputedStyle(item)
          return {
            opacity: Number(style.opacity),
            x: new DOMMatrixReadOnly(style.transform).m41,
          }
        })
      )
    }
    return samples
  })
  // 验证真实中间帧，避免只检查最终位置而漏掉动画失效或入场方向错误。
  expect(
    frames.some((frame) =>
      frame.every((item) => item.opacity > 0 && item.opacity < 1 && item.x > 0)
    )
  ).toBe(true)
  expect(
    frames.some((frame) =>
      frame.every(
        (item, index) => index === 0 || frame[index - 1].opacity > item.opacity
      )
    )
  ).toBe(true)
  for (const question of await questions.all()) await expectShown(question)
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true)

  await page.evaluate(() => scrollTo(0, 0))
  await expect.poll(() => appearance(orbit)).toMatchObject({ opacity: 0 })
  await expect
    .poll(() => appearance(questions.last()))
    .toMatchObject({ opacity: 0 })
  await orbit.evaluate((el) => el.scrollIntoView({ block: "center" }))
  await expectShown(orbit)
  await questions
    .first()
    .evaluate((el) => el.scrollIntoView({ block: "center" }))
  await expectShown(questions.first())
})

test("键盘聚焦时立即显示，四条问答均可展开", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" })
  await page.goto("/")
  const orbit = page.locator(".faq-orbit")
  const stage = page.locator(".avatar-orbit__stage")
  await expect.poll(() => appearance(orbit)).toMatchObject({ opacity: 0 })
  await stage.focus()
  expect(await appearance(orbit)).toEqual({ opacity: 1, x: 0 })
  await page.keyboard.press("Tab")
  const questions = page.locator('.faq-list [data-slot="accordion-item"]')
  const triggers = questions.getByRole("button")
  await expect(triggers.first()).toBeFocused()
  for (let index = 0; index < 4; index += 1) {
    const question = questions.nth(index)
    const trigger = triggers.nth(index)
    await expect(trigger).toBeFocused()
    expect(await appearance(question)).toEqual({ opacity: 1, x: 0 })
    await page.keyboard.press("Enter")
    await expect(trigger).toHaveAttribute("aria-expanded", "true")
    await expect(
      question.locator('[data-slot="accordion-content"]')
    ).toBeVisible()
    if (index < 3) await page.keyboard.press("Tab")
  }
})

test("减少动态效果时头像和全部问题始终完整显示", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" })
  await page.goto("/")
  const items = page.locator(
    '.faq-orbit, .faq-list [data-slot="accordion-item"]'
  )
  await expect(items).toHaveCount(5)
  for (const item of await items.all()) {
    expect(await appearance(item)).toEqual({ opacity: 1, x: 0 })
    await item.scrollIntoViewIfNeeded()
    await expectShown(item)
  }
  await page.evaluate(() => scrollTo(0, 0))
  for (const item of await items.all()) await expectShown(item)
})
