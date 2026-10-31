"use client"

import ReactMarkdown, { type Components } from "react-markdown"
import remarkBreaks from "remark-breaks"
import remarkGfm from "remark-gfm"
import { cn } from "@/lib/utils"

type HastNode = {
  type: string
  tagName?: string
  value?: string
  children?: HastNode[]
  properties?: Record<string, unknown>
}

const WORD_PATTERN = /[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]{1,2}|\S+\s*|\s+/g

const RECENT_WORD_STAGGER = 12
const WORD_STAGGER_MS = 24

/**
 * Markdown 会重建整棵 HAST，不能再用原来的 BlurWords 包整段文本。
 * 在 rehype 阶段把文本节点拆成词级 span，既保留块级结构，又恢复逐词模糊动画。
 * 只让尾部最近一小段错峰，避免长回复把所有词排到 900ms 后、看起来像结束后整段出现。
 */
function rehypeWordAnimation() {
  return (tree: HastNode) => {
    const countWords = (node: HastNode): number => {
      if (!node.children?.length) return 0
      let total = 0
      for (const child of node.children) {
        if (child.type === "element" && (child.tagName === "pre" || child.tagName === "code")) continue
        if (child.type === "element") total += countWords(child)
        else if (child.type === "text" && typeof child.value === "string") {
          total += (child.value.match(WORD_PATTERN) ?? [child.value]).filter((token) => token.trim()).length
        }
      }
      return total
    }
    const total = countWords(tree)
    let index = 0
    const walk = (node: HastNode) => {
      if (!node.children?.length) return
      const next: HastNode[] = []
      for (const child of node.children) {
        if (child.type === "element" && (child.tagName === "pre" || child.tagName === "code")) {
          next.push(child)
          continue
        }
        if (child.type === "element") {
          walk(child)
          next.push(child)
          continue
        }
        if (child.type !== "text" || typeof child.value !== "string") {
          next.push(child)
          continue
        }
        for (const token of child.value.match(WORD_PATTERN) ?? [child.value]) {
          const visible = token.trimEnd()
          if (!visible) {
            next.push({ type: "text", value: " " })
            continue
          }
          const fromEnd = total - index - 1
          const delay = fromEnd < RECENT_WORD_STAGGER
            ? (RECENT_WORD_STAGGER - 1 - fromEnd) * WORD_STAGGER_MS
            : 0
          index += 1
          next.push({
            type: "element",
            tagName: "span",
            properties: {
              className: ["animate-word-in"],
              style: `animation-delay:${delay}ms`,
            },
            children: [{ type: "text", value: visible }],
          })
          if (token.length > visible.length) next.push({ type: "text", value: " " })
        }
      }
      node.children = next
    }
    walk(tree)
  }
}

const components: Components = {
  p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary"
    >
      {children}
    </a>
  ),
  ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  h1: ({ children }) => <h1 className="mb-2 mt-4 text-lg font-semibold first:mt-0">{children}</h1>,
  h2: ({ children }) => <h2 className="mb-1.5 mt-3 text-base font-semibold first:mt-0">{children}</h2>,
  h3: ({ children }) => <h3 className="mb-1 mt-3 text-sm font-semibold first:mt-0">{children}</h3>,
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 border-border pl-3 text-muted-foreground">{children}</blockquote>
  ),
  hr: () => <hr className="my-3 border-border/70" />,
  code: ({ className, children }) => {
    const block = typeof className === "string" && className.startsWith("language-")
    return (
      <code
        className={cn(
          "font-mono",
          block
            ? "block whitespace-pre text-[11px] leading-relaxed"
            : "rounded-md bg-foreground/[0.08] px-1 py-0.5 text-[12px] text-foreground",
          className,
        )}
      >
        {children}
      </code>
    )
  },
  pre: ({ children }) => (
    <pre className="my-2 overflow-x-auto rounded-lg border border-border/70 bg-background/60 p-3">
      {children}
    </pre>
  ),
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto">
      <table className="w-full border-collapse text-xs">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border border-border/70 bg-foreground/[0.04] px-2 py-1 text-left font-medium">{children}</th>
  ),
  td: ({ children }) => <td className="border border-border/70 px-2 py-1 align-top">{children}</td>,
}

export function AIMarkdown({ text }: { text: string }) {
  return (
    <div className="ai-markdown min-w-0 break-words text-sm leading-relaxed text-foreground">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        rehypePlugins={[rehypeWordAnimation]}
        components={components}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}
