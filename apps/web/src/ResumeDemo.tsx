import { useState } from "react"
import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Check,
  CircleHelp,
  FileText,
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
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { samples, type Sample } from "./resume-samples"

function SampleReport({ sample }: { sample: Sample }) {
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
      <div className="analysis-side">
        <div className="panel-label">
          <Sparkles aria-hidden="true" /> AI 分析示例{" "}
          <Badge variant="secondary">有据可查</Badge>
        </div>
        <div className="analysis-heading">
          <span className="eyebrow">针对岗位 · {sample.role}</span>
          <h3>匹配在哪里，一目了然。</h3>
          <p>{sample.requirements}</p>
        </div>
        <div className="flex flex-col gap-3">
          {sample.matches.map((match) => (
            <div className="match-row" key={match.title}>
              <div className="status-icon">
                <Check aria-hidden="true" />
              </div>
              <div className="min-w-0 flex-1">
                <h4>{match.title}</h4>
                <p>{match.detail}</p>
              </div>
              <Dialog>
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
          <Dialog>
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

export function ResumeDemo() {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const sample = samples[selectedIndex]
  return (
    <section
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
        <div className="demo-window">
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
              <NativeSelect
                aria-label="选择演示岗位"
                value={sample.id}
                onChange={(event) =>
                  setSelectedIndex(
                    samples.findIndex((item) => item.id === event.target.value)
                  )
                }
              >
                {samples.map((item, index) => (
                  <NativeSelectOption key={item.id} value={item.id}>
                    {String(index + 1).padStart(2, "0")} · {item.role}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
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
                <span className="demo-count" role="status" aria-live="polite">
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
              </div>
            </div>
          </div>
          <SampleReport sample={sample} key={sample.id} />
          <div className="demo-status">
            <span>
              <span className="tiny-dot" /> 交互演示 · 虚构数据
            </span>
            <span>分析提供参考，决定始终由你作出</span>
          </div>
        </div>
      </ContainerScroll>
      <p className="demo-hint">
        28 组虚构示例，选择岗位或点击 <TextSearch aria-hidden="true" />{" "}
        查看匹配依据。当前展示预设结果，无需上传真实简历。
      </p>
    </section>
  )
}
