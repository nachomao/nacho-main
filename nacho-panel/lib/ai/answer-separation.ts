/* 将 Agent 回合末尾混入正文的英文规划段落拆到“深度思考”。
 * 该模型/Provider 不输出 reasoning part，但会在最终中文回答前用英文写计划或复盘；
 * 这里只在同一段落块中出现明确中文回答时拆分，纯英文回答与代码块保持原样。 */

const CJK_PATTERN = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g
const LATIN_PATTERN = /[A-Za-z]/g

function paragraphStats(block: string) {
  const cjk = (block.match(CJK_PATTERN) ?? []).length
  const latin = (block.match(LATIN_PATTERN) ?? []).length
  return { cjk, latin, ratio: cjk / Math.max(1, cjk + latin) }
}

/** 首个片段以英文为主时，视为模型正在写计划/复盘，可放进 ThoughtLine 实时展示。 */
export function looksLikePlanningText(text: string): boolean {
  const sample = text.trim().slice(0, 240)
  if (!sample) return false
  const { cjk, latin, ratio } = paragraphStats(sample)
  return latin >= 8 && cjk < 4 && ratio < 0.15
}

export function splitLeadingPlanning(text: string): { reasoning: string; answer: string } | null {
  if (!text.trim()) return null
  const blocks = text.split(/\n{2,}/)
  if (blocks.length < 2) return null
  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index]
    // 计划段里若出现代码块，无法可靠区分代码与回答，保持原样。
    if (block.includes("```")) return null
    const { cjk, ratio } = paragraphStats(block)
    if (cjk < 4 || ratio < 0.2) continue
    if (index === 0) return null
    const reasoning = blocks.slice(0, index).join("\n\n").trim()
    const answer = blocks.slice(index).join("\n\n").trim()
    if (!reasoning || !answer) return null
    return { reasoning, answer }
  }
  return null
}
