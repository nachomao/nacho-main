import { Blocks, Puzzle, Server, TerminalSquare } from "lucide-react"

/** 工具来源的显示元数据：遥测与工具分支共用。 */
export const sourceMeta = {
  skill: { label: "Skill", Icon: Blocks },
  mcp: { label: "MCP", Icon: Server },
  plugin: { label: "插件", Icon: Puzzle },
  core: { label: "内核", Icon: TerminalSquare },
} as const
