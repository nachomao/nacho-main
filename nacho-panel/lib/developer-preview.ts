/**
 * 开发者预览模式：使用固定凭据进入内置演示数据，不连接任何真实控制服务端。
 *
 * 该模式用于在无法访问 HTTP API 的托管环境（例如 v0 / HTTPS 预览）里审查界面。
 * 判定必须精确：只有 API 地址为 localhost（无端口）且 Panel API Key 为
 * localhosttest 时才进入预览，其他任何输入继续走真实的连接校验流程。
 */

export const DEVELOPER_PREVIEW_API = "http://localhost"
export const DEVELOPER_PREVIEW_KEY = "localhosttest"
/** 预览会话的锁屏凭据：退出登录后可用同一字符串重新解锁。 */
export const DEVELOPER_PREVIEW_LOGIN_SECRET = "localhosttest"

function normalizeApiCandidate(value: string) {
  const trimmed = value.trim().replace(/\/+$/, "")
  return trimmed && !/^https?:\/\//i.test(trimmed) ? `http://${trimmed}` : trimmed
}

/** 只接受 http://localhost 无端口、无子路径的形态，避免误连真实 `localhost:8443`。 */
function isPreviewApi(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === "http:"
      && url.hostname.toLowerCase() === "localhost"
      && url.port === ""
      && (url.pathname === "" || url.pathname === "/")
      && url.search === ""
      && url.hash === ""
  } catch {
    return false
  }
}

/** 表单输入是否命中开发者预览凭据；命中时不得发起真实网络请求。 */
export function isDeveloperPreviewCredentials(rawApi: string, rawKey: string) {
  return rawKey.trim() === DEVELOPER_PREVIEW_KEY && isPreviewApi(normalizeApiCandidate(rawApi))
}

/** 已保存的服务端来源是否为开发者预览。 */
export function isDeveloperPreviewSource(
  source: { mode?: string | null; api?: string | null; key?: string | null } | null | undefined,
) {
  if (!source || source.mode !== "cloud") return false
  if (typeof source.api !== "string" || typeof source.key !== "string") return false
  return source.key === DEVELOPER_PREVIEW_KEY && isPreviewApi(source.api)
}

/** 预览模式下未覆盖接口/操作时的统一错误文案。 */
export function developerPreviewUnsupportedMessage(action: string) {
  return `开发者预览模式不支持该操作：${action}`
}
