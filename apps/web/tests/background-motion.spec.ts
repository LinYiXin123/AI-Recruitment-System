import { expect, test } from "@playwright/test"

test("背景轻柔移动，可用键盘暂停和恢复，减少动态时静止且入口可用", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" })
  await page.goto("/")
  const decorations = page.locator(
    ".hero-spark, .background-spark, .background-shape"
  )
  const movingSpark = page.locator(".hero-spark-top")
  const position = () =>
    movingSpark.evaluate((el) => getComputedStyle(el).translate)
  const initialPosition = await position()
  await expect.poll(position).not.toBe(initialPosition)

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
      decorations.evaluateAll((elements) =>
        elements.flatMap((el) => el.getAnimations()).length
      )
    )
    .toBe(0)
  await expect(movingSpark).toBeVisible()
  await expect(page.getByRole("heading", { level: 1 })).toContainText("知人善任")
  await page.getByRole("link", { name: "体验简历分析", exact: true }).click()
  await expect(page).toHaveURL(/#demo$/)
  await expect(page.getByRole("combobox", { name: "选择演示岗位" })).toBeVisible()
})
