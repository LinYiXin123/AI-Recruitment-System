import { useEffect, useRef } from "react"
import { cn } from "@/lib/utils"

export interface TextScatterProps {
  text?: string
  className?: string
  as?: "h1" | "h2" | "h3" | "p" | "span" | "div"
  velocity?: number
  rotation?: number
  scale?: number
  returnAfter?: number
  duration?: number
}

export default function TextScatter({
  text = "Bounce Back.",
  className,
  as: Tag = "h1",
  velocity = 200,
  rotation = 90,
  scale = 1,
  returnAfter = 1,
  duration = 2,
}: TextScatterProps) {
  const root = useRef<HTMLElement>(null)

  useEffect(() => {
    let cancelled = false
    let dispose = () => {}
    void import("gsap")
      .then(({ gsap }) => {
        if (cancelled) return
        const media = gsap.matchMedia()
        dispose = () => media.revert()
        media.add("(prefers-reduced-motion: no-preference)", () => {
          const cleanups = Array.from(
            root.current!.querySelectorAll<HTMLElement>(
              ".text-scatter-character"
            )
          ).map((slot) => {
            const glyph = slot.firstElementChild as HTMLElement
            let animation: ReturnType<typeof gsap.timeline> | undefined
            const scatter = (event: PointerEvent) => {
              if (
                event.type === "pointerenter" &&
                event.pointerType === "touch"
              )
                return
              if (event.type === "pointerup" && event.pointerType !== "touch")
                return
              if (animation?.isActive()) return
              animation?.revert()

              const rect = slot.getBoundingClientRect()
              const centerX = rect.left + rect.width / 2
              const centerY = rect.top + rect.height / 2
              const angle = Math.atan2(
                centerY - event.clientY,
                centerX - event.clientX
              )
              const force =
                Math.min(
                  velocity,
                  event.pointerType === "touch" ? 60 : velocity
                ) *
                (0.8 + Math.random() * 0.4)
              // 给旋转后的字形留出空间，避免窄屏产生横向滚动条。
              const padding =
                (Math.hypot(rect.width, rect.height) * Math.max(1, scale)) / 2 +
                12
              const moveX = gsap.utils.clamp(
                padding - centerX,
                document.documentElement.clientWidth - padding - centerX,
                Math.cos(angle) * force
              )
              animation = gsap
                .timeline()
                .to(glyph, {
                  x: moveX,
                  y: Math.sin(angle) * force,
                  rotation: (Math.random() - 0.5) * rotation * 2,
                  scale,
                  duration,
                  ease: "power4.out",
                })
                .to(glyph, {
                  x: 0,
                  y: 0,
                  rotation: 0,
                  scale: 1,
                  duration,
                  delay: returnAfter,
                  ease: "elastic.out(1, 0.3)",
                })
                .set(glyph, { clearProps: "transform" })
            }
            slot.addEventListener("pointerenter", scatter)
            slot.addEventListener("pointerup", scatter)
            return () => {
              slot.removeEventListener("pointerenter", scatter)
              slot.removeEventListener("pointerup", scatter)
              animation?.revert()
            }
          })
          return () => cleanups.forEach((cleanup) => cleanup())
        })
      })
      .catch(() => {
        console.warn("标题动效未能加载，保留静态标题。")
      })
    return () => {
      cancelled = true
      dispose()
    }
  }, [text, velocity, rotation, scale, returnAfter, duration])

  return (
    <Tag
      ref={(element) => {
        root.current = element
      }}
      aria-label={text}
      className={cn("text-scatter", className)}
    >
      <span aria-hidden="true">
        {Array.from(text).map((char, index) => (
          <span key={index} className="text-scatter-character">
            <span className="text-scatter-glyph">
              {char === " " ? "\u00a0" : char}
            </span>
          </span>
        ))}
      </span>
    </Tag>
  )
}
