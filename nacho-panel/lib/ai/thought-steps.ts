const LIST_MARKER = /^\s*(?:#{1,6}\s+|>\s*|[-*+•]\s+|\d+[.)、]\s+)/
const INLINE_MARKUP = /\*\*|`/g

/** 把深度思考文本拆成 ThoughtLine 步骤：一行一步，去掉标题 / 列表符号与 Markdown 强调，忽略空行。 */
export function toThoughtSteps(text: string): string[] {
  if (!text) return []
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(LIST_MARKER, "").replace(INLINE_MARKUP, "").trim())
    .filter(Boolean)
}
