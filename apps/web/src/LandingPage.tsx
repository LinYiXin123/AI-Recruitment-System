import { useRef } from "react"
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  Check,
  FileSearch,
  Fingerprint,
  Focus,
  Menu,
  MessageSquareText,
  ScanLine,
  Sparkles,
} from "lucide-react"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { ResumeDemo } from "./ResumeDemo"
import { cn } from "@/lib/utils"
import "./landing.css"

const navigation = [
  ["产品能力", "#features"],
  ["工作方式", "#workflow"],
  ["常见问题", "#faq"],
]
const features = [
  {
    icon: FileSearch,
    number: "01",
    title: "从经历里，读出匹配点",
    description:
      "围绕岗位要求整理经历、技能和项目，让你更快找到值得深入了解的人。",
    note: "岗位要求 × 简历经历",
    visual: "match",
  },
  {
    icon: Focus,
    number: "02",
    title: "每一个判断，都有来处",
    description:
      "匹配点对应简历原文，信息不足单独标记。多一份依据，少一份猜测。",
    note: "结论有来源，信息有边界",
    visual: "evidence",
  },
  {
    icon: MessageSquareText,
    number: "03",
    title: "带着好问题，进入面试",
    description: "把待核实的经历变成具体问题，让下一次沟通从关键处开始。",
    note: "从筛选，走向有质量的沟通",
    visual: "interview",
  },
]
const faqs = [
  [
    "这个页面可以分析我的真实简历吗？",
    "目前可以体验两组虚构简历及预设分析结果，切换岗位、查看原文依据和面试建议。真实文件解析与 AI 模型尚未接入，因此本页不提供真实简历上传。",
  ],
  [
    "AI 会直接决定候选人是否通过吗？",
    "产品设计中，AI 负责整理与岗位相关的依据，并提示需要核实的地方。是否推进、约面或暂不考虑，由招聘人员复核后决定。",
  ],
  [
    "简历没有写到某项经历，会被判定为不符合吗？",
    "不会把“没有写明”直接等同于“不具备”。示例中特意将这类信息标为“待核实”，并提供面试追问方向。",
  ],
  [
    "示例中的候选人和分析数据从哪里来？",
    "本页所有候选人、经历及分析内容均为虚构演示材料，不对应真实求职者。演示不会收集简历，也不会调用外部 AI 服务。",
  ],
]

function Brand() {
  return (
    <a href="#top" className="brand" aria-label="知遇 AI 首页">
      <span className="brand-mark">
        <ScanLine aria-hidden="true" />
      </span>
      <span>
        知遇<span className="brand-ai">AI</span>
      </span>
    </a>
  )
}

export default function LandingPage() {
  const mobileMenu = useRef<HTMLDetailsElement>(null)
  return (
    <div id="top">
      <a className="skip-link" href="#main">
        跳转到主要内容
      </a>
      <header className="site-header">
        <div className="page-width header-inner">
          <Brand />
          <nav className="desktop-nav" aria-label="主导航">
            {navigation.map(([label, href]) => (
              <a key={href} href={href}>
                {label}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-3">
            <a
              href="#demo"
              className={cn(buttonVariants({ size: "sm" }), "header-cta")}
            >
              查看演示{" "}
              <ArrowUpRight data-icon="inline-end" aria-hidden="true" />
            </a>
            <details
              ref={mobileMenu}
              className="mobile-menu"
              onKeyDown={(event) => {
                if (event.key === "Escape" && mobileMenu.current) {
                  mobileMenu.current.open = false
                  mobileMenu.current.querySelector("summary")?.focus()
                }
              }}
            >
              <summary aria-label="打开导航菜单">
                <Menu aria-hidden="true" />
              </summary>
              <nav aria-label="手机导航">
                {navigation.map(([label, href]) => (
                  <a
                    key={href}
                    href={href}
                    onClick={() => {
                      if (mobileMenu.current) mobileMenu.current.open = false
                    }}
                  >
                    {label}
                  </a>
                ))}
              </nav>
            </details>
          </div>
        </div>
      </header>
      <main id="main">
        <section className="hero page-width" aria-labelledby="hero-title">
          <div className="hero-eyebrow">
            <Badge variant="outline">
              <span className="tiny-dot" /> AI 简历分析，为招聘而设计
            </Badge>
          </div>
          <h1 id="hero-title">
            少一点翻阅。
            <br />
            <span>多一点，知人善任。</span>
            <span className="hero-spark" aria-hidden="true">
              ✳
            </span>
          </h1>
          <p className="hero-description">
            让 AI 读懂简历里的经历，找到与岗位的连接。
            <br className="desktop-break" />
            把时间留给真正重要的事：了解人，遇见对的人。
          </p>
          <div className="hero-actions">
            <a href="#demo" className={buttonVariants({ size: "lg" })}>
              体验简历分析{" "}
              <ArrowRight data-icon="inline-end" aria-hidden="true" />
            </a>
            <a
              href="#workflow"
              className={buttonVariants({ variant: "ghost", size: "lg" })}
            >
              了解工作方式{" "}
              <ArrowDown data-icon="inline-end" aria-hidden="true" />
            </a>
          </div>
          <div className="hero-reassurance">
            <span>
              <Check aria-hidden="true" /> 无需注册
            </span>
            <span>
              <Check aria-hidden="true" /> 示例即刻体验
            </span>
            <span>
              <Check aria-hidden="true" /> 判断有据可查
            </span>
          </div>
          <div className="hero-side-note" aria-hidden="true">
            少一些重复筛选。
            <br />
            多一些彼此理解。
          </div>
        </section>
        <ResumeDemo />
        <section
          id="features"
          className="features-section page-width"
          aria-labelledby="features-title"
        >
          <div className="section-heading">
            <div>
              <span className="eyebrow">看见简历背后的人</span>
              <h2 id="features-title">不止读得快，更要看得明白。</h2>
            </div>
            <p>
              把重复的整理交给 AI，
              <br />
              把有温度的判断留给你。
            </p>
          </div>
          <div className="feature-grid">
            {features.map((feature) => (
              <article className="feature-item" key={feature.number}>
                <div className="feature-top">
                  <feature.icon aria-hidden="true" />
                  <span>{feature.number}</span>
                </div>
                <h3>{feature.title}</h3>
                <p>{feature.description}</p>
                <div
                  className={cn("feature-visual", feature.visual)}
                  aria-hidden="true"
                >
                  {feature.visual === "match" && (
                    <>
                      <span className="mini-chip">岗位需求</span>
                      <span className="connector-line" />
                      <span className="connection-icon">
                        <Sparkles />
                      </span>
                      <span className="connector-line" />
                      <span className="mini-chip">经历证据</span>
                    </>
                  )}
                  {feature.visual === "evidence" && (
                    <div className="evidence-strip">
                      <span>曾独立推进核心模块的迭代与发布</span>
                      <div>
                        <Check /> 来源：工作经历
                      </div>
                    </div>
                  )}
                  {feature.visual === "interview" && (
                    <div className="question-strip">
                      <MessageSquareText />
                      <span>
                        “能具体介绍一下，
                        <br />
                        你在这个项目中的贡献吗？”
                      </span>
                    </div>
                  )}
                </div>
                <div className="feature-note">
                  <span className="tiny-dot" />
                  {feature.note}
                </div>
              </article>
            ))}
          </div>
        </section>
        <section
          id="workflow"
          className="workflow-section"
          aria-labelledby="workflow-title"
        >
          <div className="page-width workflow-inner">
            <div className="workflow-intro">
              <span className="eyebrow">自然融入你的招聘流程</span>
              <h2 id="workflow-title">
                从一份简历，
                <br />
                到一次好对话。
              </h2>
              <p>
                围绕招聘人员的判断过程，
                <br />
                把信息、依据和下一步连在一起。
              </p>
              <a href="#demo" className="text-link">
                用示例走一遍 <ArrowRight aria-hidden="true" />
              </a>
            </div>
            <ol className="workflow-steps">
              {[
                [
                  "明确要找的人",
                  "围绕岗位职责，梳理真正需要的能力与经验。",
                  "01",
                ],
                [
                  "看懂匹配与差距",
                  "对照简历中的事实，分清材料支持和信息不足。",
                  "02",
                ],
                [
                  "带着依据，继续沟通",
                  "复核关键经历，用具体问题验证下一步判断。",
                  "03",
                ],
              ].map(([title, description, number]) => (
                <li key={number}>
                  <span className="step-number">{number}</span>
                  <div>
                    <h3>{title}</h3>
                    <p>{description}</p>
                  </div>
                  <ArrowUpRight aria-hidden="true" />
                </li>
              ))}
            </ol>
          </div>
        </section>
        <section
          id="faq"
          className="faq-section page-width"
          aria-labelledby="faq-title"
        >
          <div>
            <span className="eyebrow">你可能还想知道</span>
            <h2 id="faq-title">关于知遇 AI</h2>
            <p>开始之前，先把问题说清楚。</p>
          </div>
          <Accordion className="faq-list">
            {faqs.map(([question, answer], index) => (
              <AccordionItem key={question} value={`faq-${index}`}>
                <AccordionTrigger>{question}</AccordionTrigger>
                <AccordionContent>{answer}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </section>
        <section
          className="closing-section page-width"
          aria-labelledby="closing-title"
        >
          <div className="closing-panel">
            <div className="closing-decoration" aria-hidden="true">
              <ScanLine />
            </div>
            <div>
              <span className="eyebrow">好的招聘，从理解开始</span>
              <h2 id="closing-title">
                让下一位合适的人，
                <br className="mobile-break" />
                被你看见。
              </h2>
              <p>从一份示例简历，体验有依据的判断。</p>
            </div>
            <a
              href="#demo"
              className={buttonVariants({ variant: "secondary", size: "lg" })}
            >
              开始体验{" "}
              <ArrowUpRight data-icon="inline-end" aria-hidden="true" />
            </a>
          </div>
        </section>
      </main>
      <footer className="page-width site-footer">
        <div>
          <Brand />
          <p>让招聘回归对人的理解。</p>
        </div>
        <div className="footer-meta">
          <span>© {new Date().getFullYear()} 知遇 AI · 产品概念演示</span>
          <Dialog>
            <DialogTrigger render={<Button variant="ghost" size="sm" />}>
              <Fingerprint data-icon="inline-start" aria-hidden="true" />
              演示与隐私说明
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>演示与隐私说明</DialogTitle>
                <DialogDescription>
                  本页是招聘产品的交互演示。
                </DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-4 text-sm leading-7 text-muted-foreground">
                <p>
                  所有候选人和经历均为虚构，分析结果为预设内容。本页没有真实简历上传、账号注册或
                  AI 模型调用，也不保存你的演示操作。
                </p>
                <p>
                  正式服务的文件处理、访问权限、数据留存及删除方式，需要在功能上线前另行明确。
                </p>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </footer>
    </div>
  )
}
