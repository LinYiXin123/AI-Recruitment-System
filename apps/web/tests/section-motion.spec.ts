import { test, expect } from "@playwright/test"

test("内容随滚动反复淡入淡出，页底完整可见且入口可用", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" })
  await page.goto("/")
  await page.addStyleTag({
    content: "html { scroll-behavior: auto !important; }",
  })
  const feature = page.locator(".feature-item").first()
  const position = await feature.evaluate((el) => ({
    top: el.getBoundingClientRect().top + scrollY,
    height: el.clientHeight,
  }))
  const opacity = () =>
    feature.evaluate((el) => Number(getComputedStyle(el).opacity))
  await page.evaluate((top) => scrollTo(0, top - innerHeight), position.top)
  await expect.poll(opacity).toBeLessThan(0.02)
  await page.evaluate(
    ({ top, height }) => scrollTo(0, top - innerHeight + height / 2),
    position
  )
  await expect.poll(opacity).toBeGreaterThan(0.35)
  await expect.poll(opacity).toBeLessThan(0.65)
  await page.evaluate(
    ({ top, height }) => scrollTo(0, top - (innerHeight - height) / 2),
    position
  )
  await expect.poll(opacity).toBeGreaterThan(0.99)
  await page.evaluate(
    ({ top, height }) => scrollTo(0, top + height / 2),
    position
  )
  await expect.poll(opacity).toBeGreaterThan(0.35)
  await expect.poll(opacity).toBeLessThan(0.65)
  await page.evaluate(({ top, height }) => scrollTo(0, top + height), position)
  await expect.poll(opacity).toBeLessThan(0.02)
  await page.evaluate(
    ({ top, height }) => scrollTo(0, top - (innerHeight - height) / 2),
    position
  )
  await expect.poll(opacity).toBeGreaterThan(0.99)

  await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight))
  for (const selector of [".closing-panel", ".site-footer"]) {
    // 滚动位置取整可能差不到一像素，仍应达到视觉上的完整显示。
    await expect
      .poll(() =>
        page
          .locator(selector)
          .evaluate((el) => Number(getComputedStyle(el).opacity))
      )
      .toBeGreaterThan(0.99)
    await expect(page.locator(selector)).toHaveCSS("mask-image", "none")
  }
  await page.getByRole("button", { name: "隐私说明" }).click()
  await expect(page.getByRole("dialog")).toContainText("不保存你的演示操作")
  await page.keyboard.press("Escape")
  await page
    .locator(".closing-panel")
    .getByRole("link", { name: "开始体验", exact: true })
    .click()
  await expect(page).toHaveURL(/#demo$/)
})

test("头像无外框和控制栏，悬停、点击及聚焦时仍保持正立旋转", async ({
  page,
  isMobile,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" })
  await page.goto("/#faq")
  const stage = page.locator(".avatar-orbit__stage")
  await stage.scrollIntoViewIfNeeded()
  const rings = page.locator(".avatar-orbit__ring")
  const avatars = page.locator(".avatar-orbit__avatar")
  await expect(stage).toHaveCSS("border-top-width", "0px")
  await expect(stage).toHaveCSS("background-color", "rgba(0, 0, 0, 0)")
  await expect(stage).toHaveCSS("background-image", "none")
  await expect(page.locator(".avatar-orbit__controls")).toHaveCount(0)
  await expect(avatars).toHaveCount(28)
  await expect(rings).toHaveCount(3)
  await expect(page.locator(".faq-list").getByRole("button")).toHaveCount(4)
  await page.mouse.move(0, 0)
  const expectRotating = async () => {
    await expect(rings.first()).toHaveCSS("animation-play-state", "running")
    await expect(avatars.first()).toHaveCSS("animation-play-state", "running")
    const initial = await rings
      .first()
      .evaluate((el) => getComputedStyle(el).transform)
    await expect
      .poll(() => rings.first().evaluate((el) => getComputedStyle(el).transform))
      .not.toBe(initial)
  }
  await expectRotating()
  if (!isMobile) {
    await stage.hover()
    await expectRotating()
  }
  await stage.click()
  await expectRotating()
  await page.mouse.move(0, 0)
  await stage.focus()
  await expectRotating()
  await page.keyboard.press("Tab")
  await expect(
    page.locator(".faq-list").getByRole("button").first()
  ).toBeFocused()
  await expect(rings.first()).toHaveCSS("animation-play-state", "running")
  // 在所有圆环的同一时间点，圆环和头像的旋转矩阵应互相抵消。
  const upright = await stage.evaluate((el) => {
    el.getAnimations({ subtree: true }).forEach((animation) => {
      animation.currentTime = 5500
    })
    return [...el.querySelectorAll(".avatar-orbit__avatar")].every((avatar) => {
      const ring = avatar.closest(".avatar-orbit__ring")!
      const combined = new DOMMatrixReadOnly(
        getComputedStyle(ring).transform
      ).multiply(new DOMMatrixReadOnly(getComputedStyle(avatar).transform))
      return Math.abs(combined.a - 1) < 0.001 && Math.abs(combined.b) < 0.001
    })
  })
  expect(upright).toBe(true)
  await stage.evaluate((el) => (el as HTMLElement).blur())
  await expect(rings.first()).toHaveCSS("animation-play-state", "running")
  await page.emulateMedia({ reducedMotion: "reduce" })
  await expect(rings.first()).toHaveCSS("animation-name", "none")
  await expect(avatars.first()).toHaveCSS("animation-name", "none")
  await expect(page.locator(".section-scroll-fade").first()).toHaveCSS(
    "opacity",
    "1"
  )
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true)
})

test("头像加载失败仍有名称与占位，窄屏不裁切头像", async ({ page }) => {
  await page.route("**/avatars/28.png", (route) => route.abort())
  await page.goto("/#faq")
  await page.setViewportSize({ width: 320, height: 844 })
  const stage = page.locator(".avatar-orbit__stage")
  await stage.scrollIntoViewIfNeeded()
  const failed = stage.getByRole("img", {
    name: "候选人 28 · 品牌策划",
    exact: true,
  })
  await expect(failed.locator('[data-slot="avatar-fallback"]')).toBeVisible()
  expect(
    await stage.evaluate((el) => {
      const rect = el.getBoundingClientRect()
      return [...el.querySelectorAll(".avatar-orbit__avatar")].every(
        (avatar) => {
          const box = avatar.getBoundingClientRect()
          return (
            box.left >= rect.left &&
            box.right <= rect.right &&
            box.top >= rect.top &&
            box.bottom <= rect.bottom
          )
        }
      )
    })
  ).toBe(true)
})
