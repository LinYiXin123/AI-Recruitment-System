import { useRef, type ReactNode } from "react"
import { motion, useScroll, useTransform } from "framer-motion"
import { cn } from "@/lib/utils"

const elements = {
  div: motion.div,
  article: motion.article,
  footer: motion.footer,
}

/** 进入视口时淡入，离开时淡出；反向滚动沿同一进度恢复。 */
export function ScrollFade({
  as = "div",
  className,
  children,
}: {
  as?: keyof typeof elements
  className?: string
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const { scrollYProgress } = useScroll({
    target: ref,
    // 完整进入即为不透明，保证页脚到达页面底部时也能完整显示。
    offset: ["start end", "end end", "start start", "end start"],
  })
  const opacity = useTransform(
    scrollYProgress,
    [0, 1 / 3, 2 / 3, 1],
    [0, 1, 1, 0]
  )
  const Element = elements[as]
  return (
    <Element
      ref={ref}
      className={cn("section-scroll-fade", className)}
      style={{ opacity }}
    >
      {children}
    </Element>
  )
}
