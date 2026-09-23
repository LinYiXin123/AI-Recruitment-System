import type { AriaAttributes, CSSProperties, PointerEvent, ReactNode } from "react"
import { cn } from "@/lib/utils"
import "./spotlight-card.css"

interface GlowCardProps {
  children: ReactNode
  className?: string
  glowColor?: "blue" | "purple" | "green" | "red" | "orange"
  size?: "sm" | "md" | "lg"
  width?: CSSProperties["width"]
  height?: CSSProperties["height"]
  customSize?: boolean
  "aria-hidden"?: AriaAttributes["aria-hidden"]
}

const colors = {
  blue: "var(--primary)",
  purple: "#8755cb",
  green: "#28855e",
  red: "#c14b57",
  orange: "#c77c30",
}
const sizes = { sm: "w-48 h-64", md: "w-64 h-80", lg: "w-80 h-96" }

/** 根据用户提供的 GlowCard 适配，光晕坐标相对卡片，滚动后仍跟随指针。 */
export function GlowCard({
  children,
  className,
  glowColor = "blue",
  size = "md",
  width,
  height,
  customSize = false,
  "aria-hidden": ariaHidden,
}: GlowCardProps) {
  const followPointer = (event: PointerEvent<HTMLDivElement>) => {
    const card = event.currentTarget
    const rect = card.getBoundingClientRect()
    card.style.setProperty("--spotlight-x", `${event.clientX - rect.left}px`)
    card.style.setProperty("--spotlight-y", `${event.clientY - rect.top}px`)
    card.dataset.glowActive = "true"
  }
  const clearPointer = (event: PointerEvent<HTMLDivElement>) => {
    delete event.currentTarget.dataset.glowActive
  }

  return (
    <div
      data-glow
      aria-hidden={ariaHidden}
      className={cn(
        "spotlight-card",
        !customSize && [sizes[size], "grid grid-rows-[1fr_auto] gap-4 p-4"],
        className
      )}
      style={
        {
          "--spotlight-color": colors[glowColor],
          width,
          height,
        } as CSSProperties
      }
      onPointerMove={followPointer}
      onPointerDown={followPointer}
      onPointerLeave={clearPointer}
      onPointerCancel={clearPointer}
      onPointerUp={(event) => {
        if (event.pointerType !== "mouse") clearPointer(event)
      }}
    >
      <span className="spotlight-card__glow" aria-hidden="true" />
      {children}
    </div>
  )
}
