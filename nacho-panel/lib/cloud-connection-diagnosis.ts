/**
 * 云端连接验证失败的诊断文案。
 *
 * 面板默认由桌面端通过 http://127.0.0.1 打开，此时浏览器可以直连 HTTP API。
 * 如果面板被托管在 HTTPS 页面（例如 v0 / Vercel 预览）上，浏览器会按混合内容
 * 规则拦截对 http:// API 的 fetch；这种情况与 8443 端口、防火墙无关，需要给出
 * 与端口探测不同的提示，避免把环境限制误判成服务端故障。
 */

const LOOPBACK_IPV4_PATTERN = /^127\./

/** 浏览器把回环地址视为可信来源，HTTPS 页面允许访问 http://127.0.0.1、http://localhost。 */
export function isLoopbackHost(hostname: string) {
  const host = hostname.trim().toLowerCase()
  return host === "localhost"
    || host.endsWith(".localhost")
    || host === "[::1]"
    || host === "::1"
    || LOOPBACK_IPV4_PATTERN.test(host)
}

/** 判断页面协议与 API 协议是否构成浏览器会拦截的混合内容。 */
export function isMixedContentBlocked(pageProtocol: string, api: string) {
  try {
    const target = new URL(api)
    return pageProtocol === "https:"
      && target.protocol === "http:"
      && !isLoopbackHost(target.hostname)
  } catch {
    return false
  }
}

/** “云端对接”表单在校验失败时使用：只解释混合内容，不假设部署流程。 */
export function describeMixedContentBlock(api: string) {
  return `当前面板通过 HTTPS 打开，浏览器会拦截对 HTTP API（${api}）的请求（混合内容）。请改用桌面面板或本机 http://localhost 面板，或改用 HTTPS 地址连接。`
}

export type CloudVerificationFailureInput = {
  pageProtocol: string
  api: string
  warning?: string
  errorName?: string
}

/**
 * 部署完成后的浏览器验证失败文案。混合内容优先于端口告警：页面协议本身就是
 * 浏览器拦截的原因时，继续提示放行 8443 只会误导用户。
 */
export function describeCloudVerificationFailure(input: CloudVerificationFailureInput) {
  if (isMixedContentBlocked(input.pageProtocol, input.api)) {
    return `服务已部署，但当前面板通过 HTTPS 打开，浏览器会拦截对 HTTP API（${input.api}）的请求（混合内容）。请改用桌面面板或本机 http://localhost 面板，通过“云端对接”连接，或为服务端配置 HTTPS 后重试。`
  }
  if (input.errorName === "TimeoutError" || input.errorName === "AbortError") {
    return "连接服务端超时，请检查服务器网络与 8443 端口后重试。"
  }
  if (input.warning) return "浏览器仍无法访问服务端 API；请按上方端口提示放行后点击“重试验证并继续”。"
  return "服务已部署，但浏览器暂时无法访问 API。请检查服务器 8443 端口、防火墙及浏览器的 HTTP/HTTPS 限制，再重试验证。"
}
