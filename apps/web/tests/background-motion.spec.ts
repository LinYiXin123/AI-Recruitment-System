import { expect, test } from "@playwright/test"

test("背景明显移动，可用键盘暂停和恢复，减少动态时静止且入口可用", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" })
  await page.goto("/")
  const decorations = page.locator(
    ".background-particle, .background-particle-y"
  )
  const movingSpark = page.locator(".background-glyph").first()
  const position = () =>
    movingSpark.evaluate((el) => el.getBoundingClientRect().x)
  const initialPosition = await position()
  await expect
    .poll(async () => Math.abs((await position()) - initialPosition))
    .toBeGreaterThan(12)

  const toggle = page.getByRole("button", { name: "暂停背景动效" })
  await toggle.focus()
  await page.keyboard.press("Enter")
  const resume = page.getByRole("button", { name: "播放背景动效" })
  await expect(resume).toBeFocused()
  await expect
    .poll(() =>
      decorations.evaluateAll((elements) => [
        ...new Set(
          elements.flatMap((el) =>
            el.getAnimations().map((animation) => animation.playState)
          )
        ),
      ])
    )
    .toEqual(["paused"])
  // 验证真正停在当前帧，不能只有按钮名称改变或元素被藏起来。
  const frozen = await decorations.evaluateAll(async (elements) => {
    const animations = elements.flatMap((el) => el.getAnimations())
    const times = animations.map((animation) => animation.currentTime)
    await new Promise((resolve) => setTimeout(resolve, 150))
    return animations.every(
      (animation, index) => animation.currentTime === times[index]
    )
  })
  expect(frozen).toBe(true)
  await expect(movingSpark).toBeVisible()
  const pausedPosition = await position()
  await page.keyboard.press("Space")
  await expect(toggle).toBeFocused()
  await expect.poll(position).not.toBe(pausedPosition)

  await page.emulateMedia({ reducedMotion: "reduce" })
  await expect(toggle).toBeHidden()
  await expect
    .poll(() =>
      decorations.evaluateAll(
        (elements) => elements.flatMap((el) => el.getAnimations()).length
      )
    )
    .toBe(0)
  await expect(movingSpark).toBeVisible()
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "知人善任"
  )
  await page.getByRole("link", { name: "体验简历分析", exact: true }).click()
  await expect(page).toHaveURL(/#demo$/)
  await expect(
    page.getByRole("combobox", { name: "选择演示岗位" })
  ).toBeVisible()
})

test("背景在窗口四边反弹，缩放和滚动后不越界也不遮挡点击", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" })
  await page.goto("/")
  await page.addStyleTag({
    content: "html { scroll-behavior: auto !important; }",
  })
  const field = page.locator(".background-motion")

  for (const viewport of [
    page.viewportSize()!,
    { width: 948, height: 478 },
    { width: 320, height: 640 },
  ]) {
    await page.setViewportSize(viewport)
    const result = await field.evaluate(async (el) => {
      const animations = el.getAnimations({ subtree: true })
      animations.forEach((animation) => animation.pause())
      await Promise.all(animations.map((animation) => animation.ready))
      const particle = el.querySelector(".background-particle")!
      const vertical = particle.querySelector(".background-particle-y")!
      const glyph = particle.querySelector(".background-glyph")!
      const x = particle.getAnimations()[0]
      const y = vertical.getAnimations()[0]
      const sample = (animation: Animation, turn: number) => {
        const { duration, delay } = animation.effect!.getTiming()
        return [-250, 0, 250].map((offset) => {
          animation.currentTime =
            Number(duration) * turn + Number(delay) + offset
          const rect = glyph.getBoundingClientRect()
          return {
            left: rect.left,
            right: rect.right,
            top: rect.top,
            bottom: rect.bottom,
          }
        })
      }
      return {
        right: sample(x, 1),
        left: sample(x, 2),
        bottom: sample(y, 1),
        top: sample(y, 2),
        bounds: { width: el.clientWidth, height: el.clientHeight },
      }
    })
    for (const edge of ["left", "right", "top", "bottom"] as const) {
      const [before, contact, after] = result[edge]
      const maximum = edge === "right" || edge === "bottom"
      const limit =
        edge === "right" ? result.bounds.width : result.bounds.height
      expect(contact[edge]).toBeCloseTo(maximum ? limit : 0, 1)
      if (maximum) {
        expect(before[edge]).toBeLessThan(contact[edge])
        expect(after[edge]).toBeLessThan(contact[edge])
      } else {
        expect(before[edge]).toBeGreaterThan(contact[edge])
        expect(after[edge]).toBeGreaterThan(contact[edge])
      }
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth)
    ).toBeLessThanOrEqual(viewport.width)
  }

  const beforeScroll = await page
    .locator(".background-glyph")
    .first()
    .boundingBox()
  await page.locator("#workflow").scrollIntoViewIfNeeded()
  expect(await page.locator(".background-glyph").first().boundingBox()).toEqual(
    beforeScroll
  )
  await expect(
    page.getByRole("button", { name: "暂停背景动效" })
  ).toBeInViewport()
  expect(
    await field.evaluate((el) => {
      const rect = el
        .querySelector(".background-glyph")!
        .getBoundingClientRect()
      return (
        document
          .elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
          ?.closest(".background-motion") === null
      )
    })
  ).toBe(true)
})
