import { useEffect, useRef, useState, type ReactNode } from "react"
import {
  motion,
  useReducedMotion,
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

  return (
    <div ref={containerRef} className="container-scroll">
      <motion.div style={{ y: reducedMotion ? 0 : translate }}>
        {titleComponent}
      </motion.div>
      <motion.div
        className="container-scroll-card"
        style={{
          rotateX: reducedMotion ? 0 : rotate,
          scale: reducedMotion ? 1 : scale,
        }}
      >
        {children}
      </motion.div>
    </div>
  )
}
