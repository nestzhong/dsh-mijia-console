/**
 * 米家控制台 Host 实现。
 *
 * 职责：
 * - GET  /mijia-console/state     三台白名单设备的状态聚合 + 最近操作（只读）
 * - POST /mijia-console/control   受控写入：Host 校验设备/属性/取值范围后，
 *                                 复用同一 MCP 连接执行，再做针对性回读
 * - GET  /mijia-console/assets/*  设备图片（白名单文件名）
 *
 * 不启动第二套米家服务：全部读写通过 ctx.tools 上已注册的 mcp__<serverName>__*
 * 工具定义执行（同一 MCP stdio 进程）。凭据留在后端，不返回前端。
 * 通道操作（语音/聊天里的 mcp 工具调用）通过 tools/result 事件观察并记入操作日志。
 */
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const ROUTE_STATE = '/mijia-console/state'
const ROUTE_CONTROL = '/mijia-console/control'
const ROUTE_ASSETS = '/mijia-console/assets' // 前缀路由不能带尾斜杠：匹配条件是 pathname.startsWith(prefix + '/')
const MAX_BODY_BYTES = 64 * 1024
const MAX_OPS = 30
const READ_TIMEOUT_MS = 15_000
const WRITE_TIMEOUT_MS = 30_000
const ASSET_TYPES = { 'plug.png': 'image/png', 'acpartner.png': 'image/png', 'lightbar.png': 'image/png' }

/* ---------- 小工具 ---------- */

function optional(ctx, name) {
  try { return typeof ctx.get === 'function' ? ctx.get(name) : undefined } catch { return undefined }
}

function rejected(ctx, req, res) {
  const connection = optional(ctx, 'connection')
  if (!connection || typeof connection.requestRejection !== 'function') return false
  const status = connection.requestRejection(req)
  if (status === undefined) return false
  res.statusCode = status
  res.end()
  return true
}

function sendJson(res, status, body) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(body))
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) { reject(new Error('body too large')); req.destroy(); return }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/** 北京时间（UTC+8）的日期串，用于统计桶对齐。 */
function beijingDay(unixSec) {
  return new Date((Number(unixSec) + 28800) * 1000).toISOString().slice(0, 10)
}
function beijingToday() {
  return beijingDay(Date.now() / 1000)
}

/** 调用现有 MCP 工具定义（复用同一连接），返回文本内容。失败抛错。 */
async function callMcp(ctx, serverName, tool, args, timeoutMs) {
  const name = `mcp__${serverName}__${tool}`
  const def = ctx.tools.get(name)
  if (!def) throw new Error(`米家工具不可用：${name}（MCP 连接可能未启动）`)
  const result = await def.execute(args, { signal: AbortSignal.timeout(timeoutMs) })
  const blocks = result && Array.isArray(result.content) ? result.content : []
  const text = blocks.filter((b) => b && b.type === 'text').map((b) => b.text || '').join('\n')
  return text
}

function parseJsonText(text) {
  try { return JSON.parse(text) } catch { return null }
}

/** 统计条目 [{value:'[0.16]', time:1792339200}] → [{time, value}] */
function parseStats(text) {
  const raw = parseJsonText(text)
  if (!Array.isArray(raw)) return []
  const out = []
  for (const item of raw) {
    let value = null
    try {
      const inner = JSON.parse(item.value)
      value = Array.isArray(inner) ? Number(inner[0]) : Number(inner)
    } catch { value = Number(item.value) }
    if (Number.isFinite(value) && Number.isFinite(Number(item.time))) out.push({ time: Number(item.time), value })
  }
  return out
}

function isAuthError(message) {
  return /登录|登陆|授权|认证|auth|token|凭证|凭据/i.test(String(message))
}

/** 只读调用：超时可安全重试一次（幂等）；非超时错误立即抛出。写入绝不自动重试。 */
async function callMcpRead(ctx, serverName, tool, args) {
  let last
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await callMcp(ctx, serverName, tool, args, READ_TIMEOUT_MS)
    } catch (error) {
      last = error
      const message = String((error && error.message) || error)
      if (!/timeout|timed out|aborted/i.test(message)) throw error
      if (attempt === 0) await new Promise((r) => setTimeout(r, 600))
    }
  }
  throw last
}

/* ---------- 配置校验 ---------- */

function normalizeConfig(config) {
  const serverName = String(config?.serverName || 'mijia').trim() || 'mijia'
  const devices = Array.isArray(config?.devices) ? config.devices : []
  if (!devices.length) throw new Error('mijia-console: config.devices 不能为空')
  const normalized = devices.map((d, i) => {
    const did = String(d?.did ?? '').trim()
    const alias = String(d?.alias ?? '').trim()
    const kind = String(d?.kind ?? '').trim()
    if (!did || !alias || !kind) throw new Error(`mijia-console: devices[${i}] 缺少 did/alias/kind`)
    if (!['plug', 'light', 'acpartner'].includes(kind)) throw new Error(`mijia-console: devices[${i}] 未知 kind: ${kind}`)
    return {
      alias, did, kind,
      icon: String(d?.icon || ''),
      label: { zh: String(d?.label?.zh || alias), en: String(d?.label?.en || alias) },
      product: { zh: String(d?.product?.zh || ''), en: String(d?.product?.en || '') },
      props: d?.props || {},
      stats: d?.stats || null,
      writable: d?.writable || {},
    }
  })
  return { serverName, devices: normalized }
}

/** 写入值校验 + 转换为 MCP 线格式字符串。返回 { wire } 或抛出原因。 */
function validateWrite(device, prop, value) {
  const rule = device.writable[prop]
  if (!rule) throw new Error(`设备 ${device.alias} 不允许写入属性 ${prop}`)
  if (rule.type === 'bool') {
    if (value === true || value === 'true') return { wire: 'true' }
    if (value === false || value === 'false') return { wire: 'false' }
    throw new Error(`${prop} 需要布尔值`)
  }
  const num = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
  if (typeof num !== 'number' || !Number.isFinite(num)) throw new Error(`${prop} 需要数值`)
  if (rule.type === 'int') {
    const int = Math.round(num)
    if (int < rule.min || int > rule.max) throw new Error(`${prop} 超出范围 ${rule.min}–${rule.max}（收到 ${num}）`)
    return { wire: String(int) }
  }
  if (rule.type === 'enum') {
    const int = Math.round(num)
    if (!rule.values.includes(int)) throw new Error(`${prop} 取值 ${num} 不在允许集合 [${rule.values.join(', ')}]`)
    return { wire: String(int) }
  }
  throw new Error(`未知规则类型 ${rule.type}`)
}

/* ---------- 设备状态组装 ---------- */

async function readProps(ctx, serverName, device, propKeys) {
  const names = propKeys.map((k) => device.props[k]).filter(Boolean)
  const text = await callMcpRead(ctx, serverName, 'get_device_properties', { did: device.did, prop_names: names })
  const parsed = parseJsonText(text)
  if (!parsed || typeof parsed !== 'object') throw new Error(`属性回读格式异常`)
  return parsed
}

async function readStats(ctx, serverName, device, type, limit) {
  const text = await callMcpRead(ctx, serverName, 'get_statistics', {
    did: device.did, key: device.stats.key, data_type: type, limit,
  })
  return parseStats(text)
}

function statUnitConvert(unit, value) {
  if (unit === 'wh') return value / 1000 // 原始值按 Wh 解读（官方未确认），换算 kWh 供展示
  return value
}

/** 读取日/月统计并折算 todayKwh/monthKwh/daily；失败时保持 null，不影响实时属性。 */
async function fillStats(ctx, serverName, device, state, dailyLimit) {
  if (!device.stats) return
  const today = beijingToday()
  const [daily, monthly] = await Promise.all([
    readStats(ctx, serverName, device, device.stats.dayType, dailyLimit).catch(() => []),
    readStats(ctx, serverName, device, device.stats.monthType, 3).catch(() => []),
  ])
  if (Array.isArray(state.daily)) {
    state.daily = daily.map((e) => ({ date: beijingDay(e.time), kwh: statUnitConvert(device.stats.unit, e.value) }))
  }
  const todayEntry = daily.find((e) => beijingDay(e.time) === today)
  state.todayKwh = todayEntry ? statUnitConvert(device.stats.unit, todayEntry.value) : null
  const monthEntry = monthly.find((e) => beijingDay(e.time).slice(0, 7) === today.slice(0, 7))
  state.monthKwh = monthEntry ? statUnitConvert(device.stats.unit, monthEntry.value) : null
}

/**
 * 单台设备状态。opts.light 为 true 时只读属性（用于写入后的快速回读，不拉统计）。
 * 失败时返回带 error 且字段全部为 null 的结构（客户端按 null 渲染 "--"），不影响其他设备。
 */
async function deviceState(ctx, serverName, device, opts) {
  const light = !!(opts && opts.light)
  const base = {
    alias: device.alias, did: device.did, kind: device.kind,
    icon: device.icon, label: device.label, product: device.product,
  }
  try {
    if (device.kind === 'plug') {
      const props = await readProps(ctx, serverName, device, ['on', 'power', 'consumption', 'fault'])
      const state = {
        ...base,
        on: props[device.props.on] ?? null,
        powerW: props[device.props.power] ?? null,
        consumption: props[device.props.consumption] ?? null,
        fault: props[device.props.fault] ?? null,
        // 快速回读（light）时省略统计键，客户端合并时保留旧统计值
        ...(light ? {} : { todayKwh: null, monthKwh: null, daily: [] }),
      }
      if (!light) await fillStats(ctx, serverName, device, state, 7)
      return state
    }
    if (device.kind === 'light') {
      const props = await readProps(ctx, serverName, device, ['on', 'brightness', 'colorTemperature', 'mode'])
      return {
        ...base,
        on: props[device.props.on] ?? null,
        brightness: props[device.props.brightness] ?? null,
        colorTemperature: props[device.props.colorTemperature] ?? null,
        mode: props[device.props.mode] ?? null,
      }
    }
    // acpartner
    const props = await readProps(ctx, serverName, device, ['on', 'mode', 'targetTemperature', 'fanLevel', 'verticalSwing', 'power', 'acState'])
    const state = {
      ...base,
      on: props[device.props.on] ?? null,
      mode: props[device.props.mode] ?? null,
      targetTemperature: props[device.props.targetTemperature] ?? null,
      fanLevel: props[device.props.fanLevel] ?? null,
      verticalSwing: props[device.props.verticalSwing] ?? null,
      powerW: props[device.props.power] ?? null,
      acState: props[device.props.acState] ?? null,
      statsUnit: device.stats?.unit || null,
      ...(light ? {} : { todayKwh: null, monthKwh: null }),
    }
    if (!light) await fillStats(ctx, serverName, device, state, 2)
    return state
  } catch (error) {
    const empty = device.kind === 'plug'
      ? { on: null, powerW: null, consumption: null, fault: null, todayKwh: null, monthKwh: null, daily: [] }
      : device.kind === 'light'
        ? { on: null, brightness: null, colorTemperature: null, mode: null }
        : { on: null, mode: null, targetTemperature: null, fanLevel: null, verticalSwing: null, powerW: null, acState: null, todayKwh: null, monthKwh: null, statsUnit: device.stats?.unit || null }
    return { ...base, ...empty, error: String((error && error.message) || error) }
  }
}

/* ---------- 操作日志 ---------- */

function makeOpsLog() {
  const ops = []
  return {
    list: () => ops.slice(0, MAX_OPS),
    push(entry) {
      ops.unshift({ ts: Date.now(), ...entry })
      if (ops.length > MAX_OPS) ops.length = MAX_OPS
    },
  }
}

/* ---------- 主入口 ---------- */

export function apply(ctx, config) {
  const { serverName, devices } = normalizeConfig(config)
  const ops = makeOpsLog()
  const assetsDir = fileURLToPath(new URL('./assets/', import.meta.url))

  async function snapshot() {
    const states = await Promise.all(devices.map((d) => deviceState(ctx, serverName, d)))
    const byAlias = {}
    let okCount = 0
    let authExpired = false
    for (const state of states) {
      byAlias[state.alias] = state
      if (state.error) { if (isAuthError(state.error)) authExpired = true } else okCount++
    }
    return {
      ok: true,
      connected: okCount > 0,
      authExpired: authExpired && okCount === 0,
      updatedAt: Date.now(),
      devices: byAlias,
      ops: ops.list(),
    }
  }

  async function control(payload) {
    const aliasOrDid = String(payload?.alias || payload?.did || '').trim()
    const device = devices.find((d) => d.alias === aliasOrDid || d.did === aliasOrDid)
    if (!device) throw new Error(`目标不在白名单：${aliasOrDid || '(空)'}`)
    const prop = String(payload?.prop || '').trim()
    const { wire } = validateWrite(device, prop, payload?.value)
    await callMcp(ctx, serverName, 'set_device_property', {
      did: device.did, prop_name: device.writable[prop].prop, value: wire,
    }, WRITE_TIMEOUT_MS)
    // 写入成功后只快速回读属性（不拉统计），缩短执行中时间
    const state = await deviceState(ctx, serverName, device, { light: true })
    ops.push({
      source: 'page', alias: device.alias, kind: device.kind,
      action: `${prop} = ${wire}`,
      status: state.error ? 'sent' : 'confirmed',
      detail: state.error ? `写入已确认，回读失败：${state.error}` : undefined,
    })
    return state
  }

  /* 通道操作观察：语音/聊天中对白名单设备的写操作记入日志（无法进一步区分语音与聊天）。 */
  ctx.on('tools/result', (exec, result) => {
    try {
      const name = exec && exec.name
      if (name !== `mcp__${serverName}__set_device_property` && name !== `mcp__${serverName}__run_device_action`) return
      const args = (exec && exec.arguments) || {}
      const did = String(args.did ?? '')
      const device = devices.find((d) => d.did === did)
      if (!device) return
      const action = name.endsWith('set_device_property')
        ? `${args.prop_name} = ${args.value}`
        : `action ${args.action_name}`
      ops.push({
        source: 'channel', alias: device.alias, kind: device.kind,
        action,
        status: result && result.isError ? 'failed' : 'sent',
        detail: result && result.isError ? String(result.error?.message || '失败') : '语音/聊天指令，已发送',
      })
    } catch { /* 观察不得影响主流程 */ }
  })

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact', path: ROUTE_STATE,
    handler: async (req, res) => {
      if (rejected(ctx, req, res)) return
      if (req.method !== 'GET') { sendJson(res, 405, { message: 'GET only' }); return }
      try {
        sendJson(res, 200, await snapshot())
      } catch (error) {
        sendJson(res, 502, { ok: false, message: String((error && error.message) || error) })
      }
    },
  }), 'mijia-console: state route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact', path: ROUTE_CONTROL,
    handler: async (req, res) => {
      if (rejected(ctx, req, res)) return
      if (req.method !== 'POST') { sendJson(res, 405, { message: 'POST only' }); return }
      let payload
      try { payload = JSON.parse(await readBody(req, MAX_BODY_BYTES)) } catch {
        sendJson(res, 400, { ok: false, message: 'invalid json' }); return
      }
      try {
        const state = await control(payload)
        sendJson(res, 200, { ok: true, device: state, ops: ops.list(), updatedAt: Date.now() })
      } catch (error) {
        const message = String((error && error.message) || error)
        try {
          const aliasOrDid = String(payload?.alias || payload?.did || '').trim()
          const device = devices.find((d) => d.alias === aliasOrDid || d.did === aliasOrDid)
          ops.push({
            source: 'page', alias: device ? device.alias : aliasOrDid, kind: device ? device.kind : '',
            action: `${String(payload?.prop || '')} = ${String(payload?.value)}`,
            status: 'failed', detail: message,
          })
        } catch { /* 日志失败不覆盖主错误 */ }
        sendJson(res, 200, { ok: false, message, authExpired: isAuthError(message), ops: ops.list() })
      }
    },
  }), 'mijia-console: control route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix', path: ROUTE_ASSETS,
    handler: async (req, res) => {
      if (rejected(ctx, req, res)) return
      if (req.method !== 'GET') { sendJson(res, 405, { message: 'GET only' }); return }
      const pathname = new URL(req.url || '/', 'http://x').pathname
      const name = decodeURIComponent(pathname.slice(ROUTE_ASSETS.length).replace(/^\//, ''))
      const type = ASSET_TYPES[name]
      if (!type) { sendJson(res, 404, { message: 'unknown asset' }); return }
      try {
        const file = assetsDir + name
        const info = await stat(file)
        res.statusCode = 200
        res.setHeader('content-type', type)
        res.setHeader('content-length', String(info.size))
        res.setHeader('cache-control', 'public, max-age=3600')
        createReadStream(file).pipe(res)
      } catch {
        sendJson(res, 404, { message: 'asset not found' })
      }
    },
  }), 'mijia-console: assets route')
}
