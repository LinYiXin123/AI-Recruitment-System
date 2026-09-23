import { expect, test, type Locator, type Page } from "@playwright/test"

async function scatter(page: Page, character: Locator, isMobile: boolean) {
  if (isMobile) await character.tap()
  else {
    await character.hover({ position: { x: 2, y: 2 } })
    await page.mouse.move(0, 0)
  }
}

function displacement(glyph: Locator) {
  return glyph.evaluate((element) => {
    const transform = new DOMMatrixReadOnly(getComputedStyle(element).transform)
    return Math.hypot(transform.m41, transform.m42)
  })
}

test("标题文字可散开并自动归位，布局和标题语义保持完整", async ({
  page,
  isMobile,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" })
  if (isMobile) await page.setViewportSize({ width: 320, height: 844 })
  await page.goto("/#introduction")
  const heading = page.locator("#hero-title")
  await heading.scrollIntoViewIfNeeded()
  await expect(heading).toHaveAccessibleName(
    /少一点翻阅。\s*多一点，知人善任。/
  )
  const before = await heading.boundingBox()
  const character = heading.locator(".text-scatter-character").last()
  const glyph = character.locator(".text-scatter-glyph")
  await scatter(page, character, isMobile)
  await expect.poll(() => displacement(glyph)).toBeGreaterThan(5)
  expect(await heading.boundingBox()).toEqual(before)
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true)
  // 动画进行中再次触发也能归位，不堆积回弹任务。
  await scatter(page, character, isMobile)
  await expect(glyph).toHaveCSS("transform", "none", { timeout: 8000 })
  await page.getByRole("link", { name: "体验简历分析", exact: true }).click()
  await expect(page).toHaveURL(/#demo$/)
})

test("星球开场标题也可逐字散开并自动归位", async ({
  page,
  isMobile,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" })
  await page.goto("/")
  const heading = page.locator("#orbit-title")
  await expect(heading).toHaveAccessibleName(/每一次相遇，\s*都值得\s*认真以待。/)
  const character = heading.locator(".text-scatter-character").last()
  const glyph = character.locator(".text-scatter-glyph")
  await scatter(page, character, isMobile)
  await expect.poll(() => displacement(glyph)).toBeGreaterThan(5)
  await expect(glyph).toHaveCSS("transform", "none", { timeout: 8000 })
})

test("减少动态效果时标题静止，切换偏好立即停止并复位", async ({
  page,
  isMobile,
}) => {
  await page.goto("/#introduction")
  const character = page.locator("#hero-title .text-scatter-character").first()
  const glyph = character.locator(".text-scatter-glyph")
  await scatter(page, character, isMobile)
  await expect(glyph).toHaveCSS("transform", "none")
  await page.emulateMedia({ reducedMotion: "no-preference" })
  await scatter(page, character, isMobile)
  await expect.poll(() => displacement(glyph)).toBeGreaterThan(5)
  await page.emulateMedia({ reducedMotion: "reduce" })
  await expect(glyph).toHaveCSS("transform", "none")
  await scatter(page, character, isMobile)
  await expect(glyph).toHaveCSS("transform", "none")
})
