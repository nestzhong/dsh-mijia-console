/**
 * 米家控制台 Host 引导。Cordis 按进程缓存 ESM 模块，逻辑放在 impl.mjs，
 * 每次（重）激活带时间戳重新 import —— 改 impl.mjs 后禁用/启用插件行即可迭代，
 * 无需重启应用。
 * @module @local/mijia-console
 */
export const inject = ['webServer', 'tools']

export async function apply(ctx, config) {
  const impl = new URL('./impl.mjs', import.meta.url)
  impl.searchParams.set('v', String(Date.now()))
  const mod = await import(impl.href)
  return mod.apply(ctx, config)
}
