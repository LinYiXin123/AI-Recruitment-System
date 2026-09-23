import { test, expect, type Page } from "@playwright/test"

// 固定像素密度，避免自适应画质切换被误判为星球仍在转动。
test.use({ deviceScaleFactor: 1 })

async function globeImage(page: Page) {
  const rect = await page.locator(".orbit-stage").boundingBox()
  const viewport = page.viewportSize()!
  return page.screenshot({
    clip: {
      x: Math.min(
        viewport.width - 110,
        Math.max(0, rect!.x + rect!.width * 0.55)
      ),
      y: Math.min(viewport.height - 160, rect!.y + rect!.height * 0.7),
      width: 100,
      height: 90,
    },
  })
}

async function mascotImage(page: Page) {
  const rect = await page
    .getByRole("group", { name: "旋转知遇信封" })
    .boundingBox()
  return page.screenshot({
    clip: {
      x: rect!.x,
      y: rect!.y,
      width: rect!.width,
      height: rect!.height,
    },
  })
}

test("中文星球开场位于原首页之前，真实模型可旋转、暂停并继续", async ({
  page,
  isMobile,
}, testInfo) => {
  test.setTimeout(60000)
  const errors: string[] = []
  const requestedAssets = new Set<string>()
  page.on("pageerror", (error) => errors.push(error.message))
  page.on("request", (request) => {
    requestedAssets.add(new URL(request.url()).pathname)
  })
  await page.goto("/")
  const hero = page.locator(".orbit-delivery")
  const stage = page.getByRole("group", { name: "旋转知遇星球" })
  const mascot = page.getByRole("group", { name: "旋转知遇信封" })
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "每一次相遇，都值得认真以待。"
  )
  expect(await hero.evaluate((el) => el.nextElementSibling?.id)).toBe(
    "introduction"
  )
  await expect(stage).toHaveAttribute("data-ready", "true", { timeout: 30000 })
  await expect(mascot).toHaveAttribute("data-ready", "true", { timeout: 30000 })
  expect(requestedAssets).toContain("/orbit/models/zhiyu-mascot.glb")
  if (!isMobile) {
    const mascotBefore = await mascotImage(page)
    const mascotRect = await mascot.boundingBox()
    await page.mouse.move(
      mascotRect!.x + mascotRect!.width / 2,
      mascotRect!.y + mascotRect!.height / 2
    )
    await page.mouse.down()
    await page.mouse.move(
      mascotRect!.x + mascotRect!.width / 2 + 45,
      mascotRect!.y + mascotRect!.height / 2 - 12,
      { steps: 8 }
    )
    await expect(mascot).toHaveClass(/is-dragging/)
    await expect
      .poll(() =>
        mascot.evaluate((element) => getComputedStyle(element).position)
      )
      .toBe("absolute")
    await page.mouse.up()
    await expect(mascot).not.toHaveClass(/is-dragging/)
    await expect
      .poll(async () => (await mascotImage(page)).equals(mascotBefore))
      .toBe(false)
  }
  await expect(stage.locator("canvas")).toBeVisible()
  await stage.scrollIntoViewIfNeeded()
  await stage.focus()
  // 减少动态效果时先检查静止，再用方向键确认真实画面发生旋转。
  await page.waitForTimeout(500)
  const still = await globeImage(page)
  await page.waitForTimeout(250)
  expect((await globeImage(page)).equals(still)).toBe(true)
  await page.keyboard.press("ArrowRight")
  await expect
    .poll(async () => (await globeImage(page)).equals(still))
    .toBe(false)
  const pause = hero.getByRole("button", { name: "暂停星球，和小伙伴打招呼" })
  await pause.click()
  await expect(stage).toHaveAttribute("data-paused", "true")
  await expect(
    hero.getByRole("button", { name: "继续转动星球" })
  ).toHaveAttribute("aria-pressed", "true")
  const stopped = await globeImage(page)
  await page.waitForTimeout(350)
  expect((await globeImage(page)).equals(stopped)).toBe(true)
  await stage.focus()
  await page.keyboard.press("Space")
  await expect(stage).toHaveAttribute("data-paused", "false")
  const rect = await stage.boundingBox()
  const x = Math.min(
    page.viewportSize()!.width - 90,
    rect!.x + rect!.width * 0.55
  )
  const y = Math.min(
    page.viewportSize()!.height - 180,
    rect!.y + rect!.height * 0.55
  )
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + 60, y - 30, { steps: 10 })
  await expect(stage).toHaveClass(/is-dragging/)
  await page.mouse.up()
  await expect(stage).not.toHaveClass(/is-dragging/)
  await expect
    .poll(async () => (await globeImage(page)).equals(stopped))
    .toBe(false)
  await page.screenshot({ path: testInfo.outputPath("星球开场.png") })
  await hero.getByRole("link", { name: "开启知遇之旅" }).click()
  await expect(page).toHaveURL(/#introduction$/)
  await expect(page.locator("#hero-title")).toBeInViewport()
  await expect(stage).toHaveAttribute("data-active", "false")
  await page.getByRole("link", { name: "体验简历分析", exact: true }).click()
  await expect(
    page.getByRole("combobox", { name: "选择演示岗位" })
  ).toBeVisible()
  expect(errors).toEqual([])
})

test("模型加载失败可中文重试，失败期间仍可访问原首页", async ({ page }) => {
  await page.route("**/orbit/models/courier.glb", (route) =>
    route.fulfill({ status: 503, body: "暂时不可用" })
  )
  await page.goto("/")
  const hero = page.locator(".orbit-delivery")
  await expect(hero.getByText("小小星球暂时未能呈现")).toBeVisible({
    timeout: 20000,
  })
  await expect(hero.getByText("小小星球正在准备中…")).toHaveCount(0)
  await expect(
    hero.getByRole("button", { name: "暂停星球，和小伙伴打招呼" })
  ).toBeDisabled()
  await page.unroute("**/orbit/models/courier.glb")
  await hero.getByRole("button", { name: "重新加载星球" }).click()
  await expect(hero.locator(".orbit-stage")).toHaveAttribute(
    "data-ready",
    "true",
    { timeout: 30000 }
  )
  for (const width of [320, 713, 948, 1440]) {
    await page.setViewportSize({ width, height: 765 })
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)
      )
      .toBe(true)
  }
  await hero.getByRole("link", { name: "向下，认识知遇" }).click()
  await expect(page).toHaveURL(/#introduction$/)
})

test("三维渲染不可用时显示中文降级，首页导航继续可用", async ({ page }) => {
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      kind: string,
      ...args: unknown[]
    ) {
      if (kind.startsWith("webgl")) return null
      return Reflect.apply(getContext, this, [kind, ...args])
    } as typeof getContext
  })
  await page.goto("/")
  await expect(page.getByText("小小星球暂时未能呈现")).toBeVisible({
    timeout: 15000,
  })
  await page.getByRole("link", { name: "开启知遇之旅" }).click()
  await expect(page.locator("#hero-title")).toBeInViewport()
})

test("星球首轮资源失败后会自动恢复", async ({ page, isMobile }) => {
  test.skip(isMobile, "手机渲染已在主流程中覆盖")
  let firstRequest = true
  await page.route("**/orbit/models/courier.glb", async (route) => {
    if (firstRequest) {
      firstRequest = false
      await route.fulfill({ status: 503, body: "暂时不可用" })
      return
    }
    await route.continue()
  })

  await page.goto("/")
  await expect(
    page.getByRole("group", { name: "旋转知遇星球" })
  ).toHaveAttribute("data-ready", "true", { timeout: 30000 })
  expect(firstRequest).toBe(false)
  await expect(page.getByText("小小星球暂时未能呈现")).toHaveCount(0)
})

test("连续重新打开首页时星球仍能稳定呈现", async ({ page, isMobile }) => {
  test.skip(isMobile, "手机渲染已在主流程中覆盖")
  test.setTimeout(75000)
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))

  for (let attempt = 0; attempt < 3; attempt++) {
    await page.goto("/")
    const stage = page.getByRole("group", { name: "旋转知遇星球" })
    await expect(stage).toHaveAttribute("data-ready", "true", {
      timeout: 30000,
    })
    await expect(page.getByText("小小星球暂时未能呈现")).toHaveCount(0)
  }

  expect(errors).toEqual([])
})

test("星球默认持续转动，手机在星球上纵向滑动仍能浏览下一屏", async ({
  page,
  isMobile,
}) => {
  test.setTimeout(45000)
  await page.emulateMedia({ reducedMotion: "no-preference" })
  await page.goto("/")
  const stage = page.locator(".orbit-stage")
  await expect(stage).toHaveAttribute("data-ready", "true", { timeout: 30000 })
  await stage.scrollIntoViewIfNeeded()
  const moving = await globeImage(page)
  await expect
    .poll(async () => (await globeImage(page)).equals(moving))
    .toBe(false)
  if (isMobile) {
    const client = await page.context().newCDPSession(page)
    const before = await page.evaluate(() => scrollY)
    const rect = await stage.boundingBox()
    const x = page.viewportSize()!.width / 2
    const y = Math.min(
      page.viewportSize()!.height - 130,
      rect!.y + rect!.height / 2
    )
    await client.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x, y }],
    })
    for (let step = 1; step <= 8; step++) {
      await client.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x, y: y - step * 25 }],
      })
      await page.waitForTimeout(16)
    }
    await client.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    })
    await expect
      .poll(() => page.evaluate(() => scrollY))
      .toBeGreaterThan(before + 50)
    await expect(stage).not.toHaveClass(/is-dragging/)
    await client.detach()
  }
})
