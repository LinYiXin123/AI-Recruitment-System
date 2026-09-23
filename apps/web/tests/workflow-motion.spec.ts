import { expect, test, type Locator } from "@playwright/test"

const appearance = (item: Locator) =>
  item.evaluate((el) => ({
    opacity: Number(getComputedStyle(el).opacity),
    x: new DOMMatrixReadOnly(getComputedStyle(el).transform).m41,
  }))

const shown = (item: Locator) =>
  expect.poll(() => appearance(item)).toEqual({ opacity: 1, x: 0 })

test("工作方式七项内容分左右依次入场，离开时淡出并能再次入场", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" })
  await page.goto("/")
  await page.addStyleTag({
    content: "html { scroll-behavior: auto !important; }",
  })
  const items = page.locator(".workflow-reveal")
  await expect(items).toHaveCount(7)
  for (const [index, item] of (await items.all()).entries()) {
    const state = await appearance(item)
    expect(state.opacity).toBe(0)
    expect(Math.sign(state.x)).toBe(index < 4 ? -1 : 1)
  }

  for (const [selector, direction] of [
    [".workflow-intro", -1],
    [".workflow-steps", 1],
  ] as const) {
    await page.evaluate(() => scrollTo(0, 0))
    const group = page.locator(selector)
    const children = group.locator(".workflow-reveal")
    // 手机端上一组入场时可能同时露出前两个步骤，需等整组退出后再重播。
    await expect
      .poll(() =>
        children.evaluateAll((elements) =>
          elements.every((el) => Number(getComputedStyle(el).opacity) === 0)
        )
      )
      .toBe(true)
    const frames = await group.evaluate(async (el) => {
      const states: { opacity: number; x: number }[][] = []
      el.scrollIntoView({ block: "center" })
      const start = performance.now()
      while (performance.now() - start < 1400) {
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => resolve())
        )
        states.push(
          [...el.querySelectorAll(".workflow-reveal")].map((item) => ({
            opacity: Number(getComputedStyle(item).opacity),
            x: new DOMMatrixReadOnly(getComputedStyle(item).transform).m41,
          }))
        )
      }
      return states
    })
    expect(
      frames.some((frame) =>
        frame.every(
          (state) =>
            state.opacity > 0 &&
            state.opacity < 1 &&
            Math.sign(state.x) === direction
        )
      )
    ).toBe(true)
    expect(
      frames.some((frame) =>
        frame.every(
          (state, index) =>
            index === 0 || frame[index - 1].opacity > state.opacity
        )
      )
    ).toBe(true)
    for (const item of await children.all()) await shown(item)
  }

  // 元素仍有少量留在视口时，应出现淡出中间帧，而非直接消失。
  const heading = page.locator("#workflow-title")
  await heading.evaluate((el) => el.scrollIntoView({ block: "center" }))
  await shown(heading)
  const exitFrames = await heading.evaluate(async (el) => {
    scrollTo(
      0,
      scrollY + el.getBoundingClientRect().top + el.clientHeight * 0.9
    )
    const states: { opacity: number; x: number }[] = []
    const start = performance.now()
    while (performance.now() - start < 700) {
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve())
      )
      states.push({
        opacity: Number(getComputedStyle(el).opacity),
        x: new DOMMatrixReadOnly(getComputedStyle(el).transform).m41,
      })
    }
    return states
  })
  expect(
    exitFrames.some(
      (state) => state.opacity > 0 && state.opacity < 1 && state.x < 0
    )
  ).toBe(true)
  await expect.poll(() => appearance(heading)).toMatchObject({ opacity: 0 })
  await heading.evaluate((el) => el.scrollIntoView({ block: "center" }))
  await shown(heading)
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true)
})

test("工作方式链接可用，键盘聚焦及减少动画时完整显示", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" })
  await page.goto("/")
  const link = page.locator(".workflow-intro .text-link")
  await link.focus()
  expect(await appearance(link)).toEqual({ opacity: 1, x: 0 })
  await page.keyboard.press("Enter")
  await expect(page).toHaveURL(/#demo$/)
  await page.emulateMedia({ reducedMotion: "reduce" })
  const items = page.locator(".workflow-reveal")
  for (const item of await items.all()) await shown(item)
})
