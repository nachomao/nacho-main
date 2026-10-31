/* AI Mode UI 类型：统一由 lib/ai/chat-history.ts 定义，避免服务端持久化与界面模型漂移。 */

export type {
  Message,
  MessageAttachment,
  Session,
  StepStatus,
  ToolStep,
} from "@/lib/ai/chat-history"
