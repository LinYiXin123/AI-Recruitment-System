import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type PointerEvent,
} from "react"
import {
  motion,
  useReducedMotion,
  useMotionValue,
  useSpring,
  type MotionStyle,
  useScroll,
  useTransform,
} from "framer-motion"

export function ContainerScroll({
  titleComponent,
  children,
}: {
  titleComponent: ReactNode
  children: ReactNode
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const reducedMotion = useReducedMotion()
  const [finePointer, setFinePointer] = useState(false)
  const tiltX = useSpring(0, { stiffness: 180, damping: 24 })
  const tiltY = useSpring(0, { stiffness: 180, damping: 24 })
  const shiftX = useSpring(0, { stiffness: 180, damping: 24 })
  const shiftY = useSpring(0, { stiffness: 180, damping: 24 })
  const hoverScale = useSpring(1, { stiffness: 180, damping: 24 })
  const glowX = useMotionValue("50%")
  const glowY = useMotionValue("50%")
  const glowAlpha = useSpring(0, { stiffness: 180, damping: 24 })

  useEffect(() => {
    const query = window.matchMedia("(hover: hover) and (pointer: fine)")
    const update = () => setFinePointer(query.matches)
    update()
    query.addEventListener("change", update)
    return () => query.removeEventListener("change", update)
  }, [])

  const resetPointer = () => {
    tiltX.set(0)
    tiltY.set(0)
    shiftX.set(0)
    shiftY.set(0)
    hoverScale.set(1)
    glowAlpha.set(0)
  }
  const followPointer = (event: PointerEvent<HTMLDivElement>) => {
    if (!finePointer || reducedMotion || event.pointerType === "touch") return
    const rect = event.currentTarget.getBoundingClientRect()
    const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width))
    const y = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))
    tiltX.set(-(y * 2 - 1) * 5)
    tiltY.set((x * 2 - 1) * 6)
    shiftX.set((x * 2 - 1) * 5)
    shiftY.set((y * 2 - 1) * 3 - 5)
    hoverScale.set(1.012)
    glowX.set(`${x * 100}%`)
    glowY.set(`${y * 100}%`)
    glowAlpha.set(1)
  }
  const [isMobile, setIsMobile] = useState(
    () => window.matchMedia("(max-width: 768px)").matches
  )

  useEffect(() => {
    const query = window.matchMedia("(max-width: 768px)")
    const update = (event: MediaQueryListEvent) => setIsMobile(event.matches)
    query.addEventListener("change", update)
    return () => query.removeEventListener("change", update)
  }, [])

  const { scrollYProgress } = useScroll({
    target: containerRef,
    // 展台到达阅读位置时完成动画，后续操作不受倾斜影响。
    offset: ["start end", "start 0.12"],
  })
  // CSS 中 0° 就是正面；起点保持在 90° 内，避免出现反向文字。
  const rotate = useTransform(scrollYProgress, [0, 1], [isMobile ? 20 : 75, 0])
  const scale = useTransform(
    scrollYProgress,
    [0, 1],
    [isMobile ? 0.98 : 0.94, 1]
  )
  const translate = useTransform(scrollYProgress, [0, 1], [0, -12])

  const pointerEnabled = finePointer && !reducedMotion
  const combinedRotate = useTransform(
    () => rotate.get() + (pointerEnabled ? tiltX.get() : 0)
  )
  const combinedScale = useTransform(
    () => scale.get() * (pointerEnabled ? hoverScale.get() : 1)
  )

  return (
    <div ref={containerRef} className="container-scroll">
      <motion.div style={{ y: reducedMotion ? 0 : translate }}>
        {titleComponent}
      </motion.div>
      <motion.div
        className="container-scroll-card"
        onPointerMove={followPointer}
        onPointerLeave={resetPointer}
        onPointerCancel={resetPointer}
        style={
          {
            rotateX: reducedMotion ? 0 : combinedRotate,
            rotateY: pointerEnabled ? tiltY : 0,
            x: pointerEnabled ? shiftX : 0,
            y: pointerEnabled ? shiftY : 0,
            scale: reducedMotion ? 1 : combinedScale,
            "--glow-x": glowX,
            "--glow-y": glowY,
            "--glow-alpha": pointerEnabled ? glowAlpha : 0,
          } as MotionStyle
        }
      >
        {children}
        <span className="pointer-follow-glow" aria-hidden="true" />
      </motion.div>
    </div>
  )
}
