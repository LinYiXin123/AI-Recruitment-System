import {
  ArrowRight,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

const samples = [
  {
    id: "product",
    role: "产品经理",
    person: "候选人 A",
    experience: "4 年产品经验",
    initials: "A",
    requirements:
      "需要有企业服务产品经验，能够独立推进需求、通过数据验证结果，并与设计及研发协作。",
    title: "企业协作平台 · 产品经理",
    period: "2022 — 2026",
    paragraphs: [
      "负责企业协作平台的审批与项目管理模块，参与客户访谈，将业务流程整理为产品需求文档。",
      "独立推进审批模块改版，与设计及研发协作完成方案评审、开发跟进和版本发布。",
      "搭建关键流程的数据看板，根据使用数据调整引导流程；简历未说明改版前后的指标变化。",
    ],
    skills: ["企业服务", "需求分析", "跨团队协作"],
    matches: [
      {
        title: "企业服务产品经历",
        detail: "参与企业协作平台的核心模块建设",
        source: 0,
      },
      {
        title: "需求到交付的完整经验",
        detail: "独立推进方案评审、开发跟进与发布",
        source: 1,
      },
    ],
    missing: "数据驱动的实际成效",
    missingDetail: "有数据看板经验，具体改善结果仍需面试核实。",
    questions: [
      "审批模块改版时，你如何确定最优先解决的问题？",
      "请举例说明数据看板如何影响产品决策，最终结果如何？",
      "一次需求分歧是如何与设计、研发达成共识的？",
    ],
  },
  {
    id: "engineering",
    role: "前端工程师",
    person: "候选人 B",
    experience: "5 年前端经验",
    initials: "B",
    requirements:
      "需要有 React 与 TypeScript 项目经验，能建设复用组件，并有前端性能优化实践。",
    title: "业务研发团队 · 前端工程师",
    period: "2021 — 2026",
    paragraphs: [
      "使用 React 与 TypeScript 开发内部业务系统，负责复杂表单、数据列表及权限相关页面。",
      "整理多条业务线的通用交互，建设表单与筛选组件，补充使用文档及组件测试。",
      "参与首屏性能优化，实施路由按需加载和资源拆分；简历未提供优化前后的测量记录。",
    ],
    skills: ["React", "TypeScript", "组件开发"],
    matches: [
      {
        title: "React 与 TypeScript 实践",
        detail: "有复杂表单及业务系统开发经历",
        source: 0,
      },
      {
        title: "通用组件建设经验",
        detail: "建设复用组件，并补充文档与测试",
        source: 1,
      },
    ],
    missing: "性能优化的测量结果",
    missingDetail: "已有优化实践，效果和测量方式仍需面试核实。",
    questions: [
      "复杂表单中，你如何设计状态与校验逻辑？",
      "你如何判断一个交互值得抽成通用组件？",
      "首屏优化用了哪些测量工具，前后数据有什么变化？",
    ],
  },
]

type Sample = (typeof samples)[number]

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
          <Tabs defaultValue="product" className="gap-0">
            <div className="demo-toolbar">
              <div className="flex items-center gap-3">
                <div className="window-dots" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </div>
                <h2 id="demo-title">简历分析工作台</h2>
              </div>
              <TabsList aria-label="选择演示岗位">
                <TabsTrigger value="product">产品经理</TabsTrigger>
                <TabsTrigger value="engineering">前端工程师</TabsTrigger>
              </TabsList>
            </div>
            {samples.map((sample) => (
              <TabsContent value={sample.id} key={sample.id}>
                <SampleReport sample={sample} />
              </TabsContent>
            ))}
          </Tabs>
          <div className="demo-status">
            <span>
              <span className="tiny-dot" /> 交互演示 · 虚构数据
            </span>
            <span>分析提供参考，决定始终由你作出</span>
          </div>
        </div>
      </ContainerScroll>
      <p className="demo-hint">
        切换岗位，或点击 <TextSearch aria-hidden="true" />{" "}
        查看匹配依据。当前展示预设结果，无需上传真实简历。
      </p>
    </section>
  )
}
