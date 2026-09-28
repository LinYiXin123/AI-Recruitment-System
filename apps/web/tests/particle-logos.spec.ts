import { test, expect, type Page } from "@playwright/test"

test.use({ deviceScaleFactor: 1 })

// 读取实际运行的三维对象，不给正式页面添加测试专用的状态或调试接口。
async function readLogos(page: Page, fiberUrl: string) {
  return page.evaluate(async (url) => {
    const { _roots } = (await import(
      url
    )) as typeof import("@react-three/fiber")
    const canvas = document.querySelector<HTMLCanvasElement>(
      ".orbit-stage canvas"
    )!
    const scene = _roots.get(canvas)!.store.getState().scene
    const orbits = scene.getObjectByName("brand-orbits")!
    const logos: {
      count: number
      depth: number
      hasTexture: boolean
      colored: boolean
      world: number[]
    }[] = []
    let sprites = 0
    orbits.traverse((object) => {
      if (object.type === "Sprite") sprites++
      if (object.name !== "logo-volume") return
      const mesh = object as import("three").Points
      const positions = mesh.geometry.getAttribute("position")
      let zMin = Infinity
      let zMax = -Infinity
      for (let index = 0; index < positions.count; index++) {
        zMin = Math.min(zMin, positions.getZ(index))
        zMax = Math.max(zMax, positions.getZ(index))
      }
      const colors = mesh.geometry.getAttribute("logoColor").array
      let white = false
      for (let index = 0; index < colors.length; index += 3) {
        if (Math.min(colors[index], colors[index + 1], colors[index + 2]) > 0.7)
          white = true
      }
      logos.push({
        count: positions.count,
        depth: zMax - zMin,
        hasTexture: Object.values(
          (mesh.material as import("three").ShaderMaterial).uniforms
        ).some((uniform) => Boolean(uniform.value?.isTexture)),
        colored: !white,
        world: mesh.matrixWorld.toArray(),
      })
    })
    return { logos, sprites, center: orbits.position.toArray() }
  }, fiberUrl)
}

async function loadScene(page: Page) {
  const source = await page.request.get(
    "/src/components/ui/orbit-delivery/brand-orbits.tsx"
  )
  // 使用 Vite 实际生成的模块 URL（包括版本参数），与页面共享同一实例。
  const fiberUrl = (await source.text()).match(
    /from\s+["']([^"']*@react-three_fiber[^"']*)["']/
  )?.[1]
  expect(fiberUrl).toBeTruthy()
  await page.goto("/")
  await expect(page.locator(".orbit-stage")).toHaveAttribute(
    "data-ready",
    "true",
    { timeout: 30000 }
  )
  await expect(
    page.getByRole("group", { name: "旋转知遇信封" })
  ).toHaveAttribute("data-ready", "true", { timeout: 30000 })
  await expect
    .poll(async () => (await readLogos(page, fiberUrl!)).logos.length)
    .toBe(3)
  return fiberUrl!
}

test("三枚标识使用无底板的彩色立体颗粒，减少动态效果时保持静止", async ({
  page,
}, testInfo) => {
  test.setTimeout(60000)
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text())
  })
  const fiberUrl = await loadScene(page)
  const result = await readLogos(page, fiberUrl)
  expect(result.sprites).toBe(0)
  expect(result.center).toEqual([0, 0, 0])
  for (const logo of result.logos) {
    expect(logo.count).toBeGreaterThan(500)
    expect(logo.count).toBeLessThan(60000)
    expect(logo.depth).toBeGreaterThan(0.02)
    expect(logo.hasTexture).toBe(false)
    expect(logo.colored).toBe(true)
  }
  await page.waitForTimeout(350)
  expect(await readLogos(page, fiberUrl)).toEqual(result)
  await page
    .getByRole("button", { name: "暂停星球，和小伙伴打招呼" })
    .scrollIntoViewIfNeeded()
  await page.screenshot({ path: testInfo.outputPath("透明三维粒子标识.png") })
  expect(errors).toEqual([])
})

test("粒子标识随轨道运动，暂停冻结实际三维姿态，继续后恢复", async ({
  page,
}) => {
  test.setTimeout(60000)
  await page.emulateMedia({ reducedMotion: "no-preference" })
  const fiberUrl = await loadScene(page)
  const moving = await readLogos(page, fiberUrl)
  await expect.poll(() => readLogos(page, fiberUrl)).not.toEqual(moving)
  await page.getByRole("button", { name: "暂停星球，和小伙伴打招呼" }).click()
  await expect(page.locator(".orbit-stage")).toHaveAttribute(
    "data-paused",
    "true"
  )
  await page.waitForTimeout(150)
  const paused = await readLogos(page, fiberUrl)
  await page.waitForTimeout(400)
  expect(await readLogos(page, fiberUrl)).toEqual(paused)
  await page.getByRole("button", { name: "继续转动星球" }).click()
  await expect.poll(() => readLogos(page, fiberUrl)).not.toEqual(paused)
})
