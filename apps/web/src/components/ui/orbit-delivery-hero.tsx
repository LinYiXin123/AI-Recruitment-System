import {
  Component,
  Suspense,
  lazy,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react"
import { useReducedMotion } from "framer-motion"
import {
  ArrowDown,
  ArrowRight,
  Globe2,
  Pause,
  Play,
  RotateCcw,
} from "lucide-react"
import { Button, buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import "./orbit-delivery-hero.css"

const OrbitScene = lazy(() => import("./orbit-delivery/scene"))

export interface OrbitSceneProps {
  assetBaseUrl: string
  motion: RefObject<{
    planetAngle: number
    planetVelocity: number
    dragTarget: number
    characterTarget: number
    characterAngle: number
    characterVelocity: number
    phase: number
    activity: number
    direction: number
    time: number
    dragging: boolean
    lastInteraction: number
    pitchAngle: number
    pitchVelocity: number
    pitchTarget: number
    heading?: number
    cameraHeading?: number
  }>
  active: boolean
  auto: boolean
  reduced: boolean
  onReady: (ready: boolean) => void
  onFailure: () => void
}

class SceneBoundary extends Component<{
  children: ReactNode
  fallback: ReactNode
  onFailure: () => void
}> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch() {
    this.props.onFailure()
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

/** 用户提供的 Orbit Delivery 场景；导航、文案和操作接入知遇首页。 */
export default function OrbitDeliveryHero({
  assetBaseUrl = "/orbit/",
}: {
  assetBaseUrl?: string
}) {
  const stage = useRef<HTMLDivElement>(null)
  const motion = useRef({
    planetAngle: 0,
    planetVelocity: 0,
    dragTarget: 0,
    characterTarget: 0,
    characterAngle: 0,
    characterVelocity: 0,
    phase: 0,
    activity: 0,
    direction: 1,
    time: 0,
    dragging: false,
    lastInteraction: -4,
    pitchAngle: 0,
    pitchVelocity: 0,
    pitchTarget: 0,
  })
  const drag = useRef<{ id: number; x: number; y: number } | null>(null)
  const reduced = useReducedMotion()
  const [mounted, setMounted] = useState(false)
  const [visible, setVisible] = useState(false)
  const [tabVisible, setTabVisible] = useState(true)
  const [paused, setPaused] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        setVisible(entry.isIntersecting)
        if (entry.isIntersecting) setMounted(true)
      },
      { threshold: 0.01 }
    )
    if (stage.current) observer.observe(stage.current)
    const onVisibility = () => {
      setTabVisible(!document.hidden)
      if (document.hidden) {
        motion.current.dragging = false
        motion.current.lastInteraction = motion.current.time
        drag.current = null
        setDragging(false)
      }
    }
    onVisibility()
    document.addEventListener("visibilitychange", onVisibility)
    return () => {
      observer.disconnect()
      document.removeEventListener("visibilitychange", onVisibility)
    }
  }, [])

  const release = (id: number) => {
    if (drag.current?.id !== id) return
    drag.current = null
    motion.current.dragging = false
    motion.current.lastInteraction = motion.current.time
    setDragging(false)
    if (stage.current?.hasPointerCapture(id))
      stage.current.releasePointerCapture(id)
  }
  const toggleMotion = () => {
    if (!ready || failed) return
    if (drag.current) release(drag.current.id)
    const m = motion.current
    m.planetVelocity = m.pitchVelocity = 0
    m.dragTarget = m.planetAngle
    m.pitchTarget = m.pitchAngle
    if (paused) m.lastInteraction = m.time - 4
    setPaused(!paused)
  }
  const retry = () => {
    setReady(false)
    setFailed(false)
    setAttempt(attempt + 1)
  }
  const fallback = (
    <div className="orbit-feedback orbit-error" role="status">
      <Globe2 aria-hidden="true" />
      <p>小小星球暂时未能呈现</p>
      <span>可以重试，或继续向下了解知遇。</span>
      <Button variant="outline" size="sm" onClick={retry}>
        <RotateCcw data-icon="inline-start" />
        重新加载星球
      </Button>
    </div>
  )

  return (
    <section className="orbit-delivery" aria-labelledby="orbit-title">
      <div className="orbit-copy">
        <p className="orbit-eyebrow">
          <span />
          让人才与机会，双向奔赴
        </p>
        <h1 id="orbit-title">
          每一次相遇，
          <br />
          都值得
          <br />
          <em>认真以待。</em>
        </h1>
        <p className="orbit-description">
          世界很大，对的人值得被看见。
          <br />
          让知遇陪你，发现简历背后的可能。
        </p>
        <a
          href="#introduction"
          className={cn(buttonVariants({ size: "lg" }), "orbit-explore")}
        >
          开启知遇之旅
          <ArrowRight data-icon="inline-end" aria-hidden="true" />
        </a>
      </div>
      <div className="orbit-visual">
        <div
          ref={stage}
          className={cn("orbit-stage", dragging && "is-dragging")}
          tabIndex={0}
          role="group"
          aria-roledescription="可交互的三维星球"
          aria-label="旋转知遇星球"
          aria-describedby="orbit-instructions"
          data-ready={ready && !failed}
          data-active={visible && tabVisible}
          data-paused={paused}
          onPointerDown={(event) => {
            if (
              paused ||
              !ready ||
              failed ||
              !event.isPrimary ||
              event.button !== 0
            )
              return
            event.currentTarget.setPointerCapture(event.pointerId)
            drag.current = {
              id: event.pointerId,
              x: event.clientX,
              y: event.clientY,
            }
            const m = motion.current
            m.dragTarget = m.planetAngle
            m.pitchTarget = m.pitchAngle
            m.dragging = true
            m.lastInteraction = m.time
            setDragging(true)
          }}
          onPointerMove={(event) => {
            if (paused || drag.current?.id !== event.pointerId) return
            const dx = event.clientX - drag.current.x
            const dy = event.clientY - drag.current.y
            const sensitivity =
              5 / Math.max(360, event.currentTarget.clientWidth)
            const m = motion.current
            m.dragTarget = Math.max(
              m.planetAngle - 0.5,
              Math.min(m.planetAngle + 0.5, m.dragTarget + dx * sensitivity)
            )
            m.pitchTarget = Math.max(
              m.pitchAngle - 0.4,
              Math.min(
                m.pitchAngle + 0.4,
                m.pitchTarget + dy * sensitivity * 0.7
              )
            )
            drag.current.x = event.clientX
            drag.current.y = event.clientY
            m.lastInteraction = m.time
          }}
          onPointerUp={(event) => release(event.pointerId)}
          onPointerCancel={(event) => release(event.pointerId)}
          onLostPointerCapture={(event) => release(event.pointerId)}
          onKeyDown={(event) => {
            if (!ready || failed) return
            if (event.key === " ") {
              event.preventDefault()
              if (!event.repeat) toggleMotion()
            }
            if (
              !paused &&
              ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
                event.key
              )
            ) {
              event.preventDefault()
              const m = motion.current
              if (event.key === "ArrowLeft" || event.key === "ArrowRight")
                m.planetVelocity += event.key === "ArrowRight" ? 0.65 : -0.65
              else m.pitchVelocity += event.key === "ArrowDown" ? 0.4 : -0.4
              m.lastInteraction = m.time
            }
          }}
        >
          {failed ? (
            fallback
          ) : (
            <SceneBoundary
              key={attempt}
              fallback={fallback}
              onFailure={() => setFailed(true)}
            >
              {mounted && (
                <Suspense fallback={null}>
                  <OrbitScene
                    assetBaseUrl={assetBaseUrl}
                    motion={motion}
                    active={visible && tabVisible}
                    auto={!paused}
                    reduced={!!reduced}
                    onReady={setReady}
                    onFailure={() => setFailed(true)}
                  />
                </Suspense>
              )}
              {!ready && (
                <div className="orbit-feedback" role="status">
                  <span className="orbit-loader" />
                  小小星球正在准备中…
                </div>
              )}
            </SceneBoundary>
          )}
        </div>
      </div>
      <div className="orbit-caption" aria-hidden="true">
        <p>
          {paused
            ? "停一停，\n和你打个招呼"
            : dragging
              ? "转动世界，\n发现新的可能"
              : "轻轻拖动，\n让世界转起来"}
        </p>
        <svg viewBox="0 0 180 165" fill="none">
          <path
            d="M161 148C137 82 103 39 28 14m0 0 6 16m-6-16 19-2"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      <p id="orbit-instructions" className="sr-only">
        拖动星球，或聚焦后用方向键旋转。空格键暂停，让小伙伴向你招手；再次按下继续。暂停时停止旋转。手机上左右拖动星球，上下滑动浏览页面。
      </p>
      <div className="orbit-clouds" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
        <i />
      </div>
      <div className="orbit-bottom">
        <p>
          把目光，
          <br />
          交还给人。
        </p>
        <Button
          variant="ghost"
          size="sm"
          onClick={toggleMotion}
          disabled={!ready || failed}
          aria-pressed={paused}
          aria-label={paused ? "继续转动星球" : "暂停星球，和小伙伴打招呼"}
        >
          {paused ? (
            <Play data-icon="inline-start" />
          ) : (
            <Pause data-icon="inline-start" />
          )}
          {paused ? "继续转动" : "暂停，打个招呼"}
        </Button>
        <a href="#introduction">
          向下，认识知遇
          <ArrowDown aria-hidden="true" />
        </a>
      </div>
    </section>
  )
}
