import { useEffect, useRef, useState } from "react"
import {
  AnimatePresence,
  motion,
  useInView,
  useIsPresent,
  useReducedMotion,
} from "framer-motion"
import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Check,
  CircleHelp,
  FileText,
  Pause,
  Play,
  ScanLine,
  Sparkles,
  TextSearch,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ContainerScroll } from "@/components/ui/container-scroll-animation"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { samples, type Sample } from "./resume-samples"

const sampleOptions = samples.map((sample, index) => ({
  value: sample.id,
  label: `${String(index + 1).padStart(2, "0")} · ${sample.role}`,
}))

function SampleReport({
  sample,
  onDialogOpenChange,
}: {
  sample: Sample
  onDialogOpenChange: (open: boolean) => void
}) {
  return (
    <div className="demo-columns">
      <div className="resume-side">
        <div className="panel-label">
          <FileText aria-hidden="true" /> 原始简历 <span>示例材料</span>
        </div>
        <div className="resume-paper">
          <div className="flex items-center gap-4">
            <div className="resume-avatar" aria-hidden="true">
              {sample.initials}
              <img
                src={sample.avatar}
                alt=""
                width={52}
                height={52}
                decoding="async"
                onError={(event) => {
                  event.currentTarget.hidden = true
                }}
              />
            </div>
            <div>
              <h3>{sample.person}</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                {sample.role} · {sample.experience}
              </p>
            </div>
          </div>
          <div className="my-6 flex flex-wrap gap-2">
            {sample.skills.map((skill) => (
              <Badge key={skill} variant="outline">
                {skill}
              </Badge>
            ))}
          </div>
          <p className="resume-section-label">工作经历</p>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-sm font-semibold">{sample.title}</h4>
            <span className="text-xs text-muted-foreground">
              {sample.period}
            </span>
          </div>
          <div className="mt-4 flex flex-col gap-3">
            {sample.paragraphs.map((paragraph, index) => (
              <p
                key={paragraph}
                className={
                  index === 0 ? "resume-highlight" : "resume-paragraph"
                }
              >
                {paragraph}
              </p>
            ))}
          </div>
          <div className="resume-paper-footer">
            <ScanLine aria-hidden="true" /> 让经历里的价值，被看见。
          </div>
        </div>
      </div>
      <div
        className="analysis-side"
        data-layout={sample.layout}
        data-palette={sample.palette}
      >
        <div className="panel-label">
          <Sparkles aria-hidden="true" /> AI 分析示例
        </div>
        <div className="analysis-heading">
          <span className="eyebrow">针对岗位 · {sample.role}</span>
          <h3>
            {
              {
                spotlight: "匹配在哪里，一目了然。",
                cards: "把优势，逐项展开。",
                timeline: "沿着经历，找到依据。",
                split: "看见亮点，也留意疑问。",
              }[sample.layout]
            }
          </h3>
          <p>{sample.requirements}</p>
        </div>
        <div className="analysis-evidence">
          {sample.matches.map((match) => (
            <div className="match-row" key={match.title}>
              <div className="status-icon">
                <Check aria-hidden="true" />
              </div>
              <div className="min-w-0 flex-1">
                <h4>{match.title}</h4>
                <p>{match.detail}</p>
              </div>
              <Dialog onOpenChange={onDialogOpenChange}>
                <DialogTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`查看${match.title}的简历依据`}
                    />
                  }
                >
                  <TextSearch aria-hidden="true" />
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>{match.title}：简历依据</DialogTitle>
                    <DialogDescription>
                      {sample.person} · {sample.title} · 虚构示例
                    </DialogDescription>
                  </DialogHeader>
                  <blockquote className="source-quote">
                    {sample.paragraphs[match.source]}
                  </blockquote>
                  <p className="text-sm leading-7 text-muted-foreground">
                    这是简历中的自述材料，适合作为面试追问的起点，仍需人工核实。
                  </p>
                </DialogContent>
              </Dialog>
            </div>
          ))}
          <div className="match-row pending-row">
            <div className="status-icon">
              <CircleHelp aria-hidden="true" />
            </div>
            <div>
              <h4>
                {sample.missing} <span>待核实</span>
              </h4>
              <p>{sample.missingDetail}</p>
            </div>
          </div>
        </div>
        <div className="analysis-bottom">
          <p>
            <span className="tiny-dot" /> 建议围绕待核实项进一步沟通
          </p>
          <Dialog onOpenChange={onDialogOpenChange}>
            <DialogTrigger render={<Button variant="outline" size="sm" />}>
              查看面试建议{" "}
              <ArrowRight data-icon="inline-end" aria-hidden="true" />
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{sample.role} · 面试建议</DialogTitle>
                <DialogDescription>
                  针对示例经历的追问方向，供面试官调整使用。
                </DialogDescription>
              </DialogHeader>
              <ol className="question-list">
                {sample.questions.map((question) => (
                  <li key={question}>{question}</li>
                ))}
              </ol>
            </DialogContent>
          </Dialog>
        </div>
      </div>
    </div>
  )
}

function SampleSlide({
  sample,
  reducedMotion,
  onDialogOpenChange,
}: {
  sample: Sample
  reducedMotion: boolean
  onDialogOpenChange: (open: boolean) => void
}) {
  const present = useIsPresent()
  return (
    <motion.div
      className="demo-slide"
      inert={!present}
      initial={{ opacity: reducedMotion ? 1 : 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: reducedMotion ? 1 : 0 }}
      transition={{ duration: reducedMotion ? 0 : 0.8, ease: "easeInOut" }}
    >
      <SampleReport sample={sample} onDialogOpenChange={onDialogOpenChange} />
    </motion.div>
  )
}

export function ResumeDemo() {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const sample = samples[selectedIndex]
  const sectionRef = useRef<HTMLElement>(null)
  const inView = useInView(sectionRef, { amount: 0.2 })
  const reducedMotion = useReducedMotion()
  const [playing, setPlaying] = useState(true)
  const [menuOpen, setMenuOpen] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [focusWithin, setFocusWithin] = useState(false)
  const [pageVisible, setPageVisible] = useState(() => !document.hidden)
  const autoPlaying =
    playing &&
    !reducedMotion &&
    inView &&
    pageVisible &&
    !menuOpen &&
    !dialogOpen &&
    !focusWithin

  useEffect(() => {
    const update = () => setPageVisible(!document.hidden)
    document.addEventListener("visibilitychange", update)
    return () => document.removeEventListener("visibilitychange", update)
  }, [])

  useEffect(() => {
    if (!autoPlaying) return
    const timer = window.setTimeout(() => {
      setSelectedIndex((index) => (index + 1) % samples.length)
    }, 3000)
    return () => window.clearTimeout(timer)
  }, [autoPlaying, selectedIndex])
  return (
    <section
      ref={sectionRef}
      id="demo"
      className="demo-section page-width"
      aria-labelledby="demo-title"
    >
      <ContainerScroll
        titleComponent={
          <div className="demo-caption">
            <span className="eyebrow">从一份简历开始</span>
            <p>读懂经历，也看见值得追问的地方。</p>
          </div>
        }
      >
        <div
          className="demo-window"
          onFocusCapture={(event) =>
            setFocusWithin(
              !(event.target as HTMLElement).closest("[data-autoplay-control]")
            )
          }
          onBlurCapture={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget))
              setFocusWithin(false)
          }}
        >
          <div className="demo-toolbar">
            <div className="flex items-center gap-3">
              <div className="window-dots" aria-hidden="true">
                <i />
                <i />
                <i />
              </div>
              <h2 id="demo-title">简历分析工作台</h2>
            </div>
            <div className="demo-controls">
              <div className="demo-select">
                <Select
                  items={sampleOptions}
                  value={sample.id}
                  open={menuOpen}
                  onOpenChange={setMenuOpen}
                  modal={false}
                  onValueChange={(value) => {
                    const index = samples.findIndex((item) => item.id === value)
                    if (index >= 0) setSelectedIndex(index)
                  }}
                >
                  <SelectTrigger aria-label="选择演示岗位">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent inline alignItemWithTrigger={false}>
                    {sampleOptions.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="demo-pagination">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="上一个示例"
                  disabled={selectedIndex === 0}
                  onClick={() => setSelectedIndex((index) => index - 1)}
                >
                  <ChevronLeft aria-hidden="true" />
                </Button>
                <span
                  className="demo-count"
                  role="status"
                  aria-live={autoPlaying ? "off" : "polite"}
                >
                  {String(selectedIndex + 1).padStart(2, "0")} /{" "}
                  {samples.length}
                </span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="下一个示例"
                  disabled={selectedIndex === samples.length - 1}
                  onClick={() => setSelectedIndex((index) => index + 1)}
                >
                  <ChevronRight aria-hidden="true" />
                </Button>
                {!reducedMotion && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    data-autoplay-control
                    aria-label={playing ? "暂停自动轮播" : "开始自动轮播"}
                    onClick={() => setPlaying((value) => !value)}
                  >
                    {playing ? (
                      <Pause aria-hidden="true" />
                    ) : (
                      <Play aria-hidden="true" />
                    )}
                  </Button>
                )}
              </div>
            </div>
          </div>
          <AnimatePresence initial={false} mode="wait">
            <SampleSlide
              key={sample.id}
              sample={sample}
              reducedMotion={!!reducedMotion}
              onDialogOpenChange={setDialogOpen}
            />
          </AnimatePresence>
          <div className="demo-status">
            <span>分析提供参考，决定始终由你作出</span>
          </div>
        </div>
      </ContainerScroll>
      <p className="demo-hint">
        选择岗位或点击 <TextSearch aria-hidden="true" /> 查看匹配依据。
      </p>
    </section>
  )
}
