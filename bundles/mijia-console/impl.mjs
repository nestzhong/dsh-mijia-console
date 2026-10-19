/**
 * 米家控制台 Host 实现。
 *
 * 职责：
 * - GET  /mijia-console/state     内存快照（立即返回，无云端请求）
 * - GET  /mijia-console/device    单设备状态/用电统计独立刷新
 * - POST /mijia-console/control   受控写入：Host 校验设备/属性/取值范围后，
 *                                 复用同一 MCP 连接执行，接收后立即返回，后台回读
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
const ROUTE_DEVICE = '/mijia-console/device'
const ROUTE_CONTROL = '/mijia-console/control'
const ROUTE_ASSETS = '/mijia-console/assets' // 前缀路由不能带尾斜杠：匹配条件是 pathname.startsWith(prefix + '/')
const MAX_BODY_BYTES = 64 * 1024
const MAX_OPS = 30
const READ_TIMEOUT_MS = 15_000
const WRITE_TIMEOUT_MS = 30_000
const STATE_TTL_MS = 10_000
const STATS_TTL_MS = 5 * 60_000
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
async function callMcp(ctx, serverName, tool, args, timeoutMs, lifecycleSignal) {
  const name = `mcp__${serverName}__${tool}`
  const def = ctx.tools.get(name)
  if (!def) throw new Error(`米家工具不可用：${name}（请检查米家 MCP 插件）`)
  const signal = lifecycleSignal
    ? AbortSignal.any([AbortSignal.timeout(timeoutMs), lifecycleSignal])
    : AbortSignal.timeout(timeoutMs)
  const startedAt = Date.now()
  let outcome = 'ok'
  try {
    // Some tool adapters ignore AbortSignal. Race the caller as well; never retry writes.
    const result = await new Promise((resolve, reject) => {
      const abort = () => reject(signal.reason || new Error('aborted'))
      signal.addEventListener('abort', abort, { once: true })
      Promise.resolve().then(() => { signal.throwIfAborted(); return def.execute(args, { signal }) })
        .then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
      if (signal.aborted) abort()
    })
    const blocks = result && Array.isArray(result.content) ? result.content : []
    const text = blocks.filter((b) => b && b.type === 'text').map((b) => b.text || '').join('\n')
    if (result?.isError) throw new Error(text || result.error?.message || '米家工具执行失败')
    if (!text.trim()) throw new Error('米家工具返回空结果')
    return text
  } catch (error) {
    outcome = /timeout|timed out|aborted/i.test(String(error?.message || error)) ? 'timeout' : 'error'
    throw error
  } finally {
    // Timing only: never log credentials, device IDs, argument values or response bodies.
    console.info('[mijia-console]', JSON.stringify({ event: 'mcp.finish', tool, outcome, elapsedMs: Date.now() - startedAt }))
  }
}

function parseJsonText(text) {
  try { return JSON.parse(text) } catch { return null }
}

/** 统计条目 [{value:'[0.16]', time:1792339200}] → [{time, value}] */
function parseStats(text) {
  const raw = parseJsonText(text)
  if (!Array.isArray(raw)) throw new Error('用电统计返回格式异常')
  const out = []
  for (const item of raw) {
    if (!item || item.value == null || item.value === '' || item.time == null) continue
    let inner
    try { inner = JSON.parse(item.value) } catch { inner = item.value }
    const first = Array.isArray(inner) ? inner[0] : inner
    if (first == null || first === '' || typeof first === 'boolean') continue
    const value = Number(first), time = Number(item.time)
    if (Number.isFinite(value) && value >= 0 && Number.isFinite(time) && !Number.isNaN(new Date(time * 1000).getTime())) out.push({ time, value })
  }
  if (raw.length && !out.length) throw new Error('用电统计不含有效数值')
  return out
}

function isAuthError(message) {
  return /登录|登陆|授权|认证|auth|token|凭证|凭据/i.test(String(message))
}

/** Single read attempt. Recover on the next visible refresh or explicit retry, without a hidden 30s retry chain. */
async function callMcpRead(ctx, serverName, tool, args, lifecycleSignal) {
  return callMcp(ctx, serverName, tool, args, READ_TIMEOUT_MS, lifecycleSignal)
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
    if (!Number.isInteger(num)) throw new Error(`${prop} 需要整数`)
    const int = num
    if (int < rule.min || int > rule.max) throw new Error(`${prop} 超出范围 ${rule.min}–${rule.max}（收到 ${num}）`)
    return { wire: String(int) }
  }
  if (rule.type === 'enum') {
    if (!Number.isInteger(num)) throw new Error(`${prop} 需要整数`)
    const int = num
    if (!rule.values.includes(int)) throw new Error(`${prop} 取值 ${num} 不在允许集合 [${rule.values.join(', ')}]`)
    return { wire: String(int) }
  }
  throw new Error(`未知规则类型 ${rule.type}`)
}

/* ---------- 设备状态组装 ---------- */

async function readProps(ctx, serverName, device, propKeys, signal) {
  const names = propKeys.map((k) => device.props[k]).filter(Boolean)
  const text = await callMcpRead(ctx, serverName, 'get_device_properties', { did: device.did, prop_names: names }, signal)
  const parsed = parseJsonText(text)
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object' || !names.some((name) => Object.hasOwn(parsed, name))) throw new Error(`属性回读格式异常`)
  return parsed
}

async function readStats(ctx, serverName, device, type, limit, signal) {
  const text = await callMcpRead(ctx, serverName, 'get_statistics', {
    did: device.did, key: device.stats.key, data_type: type, limit,
  }, signal)
  return parseStats(text)
}

function statUnitConvert(unit, value) {
  if (unit === 'wh') return value / 1000 // 原始值按 Wh 解读（官方未确认），换算 kWh 供展示
  return value
}

/** Statistics have their own cache and endpoint; never delay switches or current state. */
async function statisticsState(ctx, serverName, device, signal) {
  const today = beijingToday()
  const [daily, monthly] = await Promise.all([
    readStats(ctx, serverName, device, device.stats.dayType, device.kind === 'plug' ? 7 : 2, signal),
    readStats(ctx, serverName, device, device.stats.monthType, 3, signal),
  ])
  const todayEntry = daily.find((e) => beijingDay(e.time) === today)
  const monthEntry = monthly.find((e) => beijingDay(e.time).slice(0, 7) === today.slice(0, 7))
  return {
    todayKwh: todayEntry ? statUnitConvert(device.stats.unit, todayEntry.value) : null,
    monthKwh: monthEntry ? statUnitConvert(device.stats.unit, monthEntry.value) : null,
    ...(device.kind === 'plug' ? { daily: daily.map((e) => ({ date: beijingDay(e.time), kwh: statUnitConvert(device.stats.unit, e.value) })) } : {}),
  }
}

async function deviceState(ctx, serverName, device, signal) {
  const keys = Object.keys(device.props)
  const props = await readProps(ctx, serverName, device, keys, signal)
  const state = {}
  const boolKeys = new Set(['on', 'verticalSwing'])
  const rename = { power: 'powerW' }
  for (const key of keys) {
    const value = props[device.props[key]]
    state[rename[key] || key] = boolKeys.has(key)
      ? (typeof value === 'boolean' ? value : null)
      : key === 'acState'
        ? (typeof value === 'string' ? value : null)
        : (typeof value === 'number' && Number.isFinite(value) ? value : null)
  }
  return state
}

/* ---------- 操作日志 ---------- */

function makeOpsLog() {
  const ops = []
  let version = 0
  return {
    list: () => ops.map((op) => ({ ...op })),
    version: () => version,
    push(entry) {
      const op = { id: ++version, ts: Date.now(), ...entry }
      ops.unshift(op)
      if (ops.length > MAX_OPS) ops.length = MAX_OPS
      return op.id
    },
    update(id, patch) {
      const op = ops.find((entry) => entry.id === id)
      if (op) { Object.assign(op, patch); version++ }
    },
  }
}

/* ---------- 主入口 ---------- */

export function apply(ctx, config) {
  const { serverName, devices } = normalizeConfig(config)
  const ops = makeOpsLog()
  const assetsDir = fileURLToPath(new URL('./assets/', import.meta.url))
  const lifecycle = new AbortController()
  let active = true
  let revision = 0
  const epoch = `${Date.now()}-${Math.random().toString(36).slice(2)}`
  const cache = new Map(devices.map((d) => [d.alias, {
    alias: d.alias, did: d.did, kind: d.kind, icon: d.icon, label: d.label, product: d.product,
    on: null, powerW: null, brightness: null, colorTemperature: null, mode: null,
    targetTemperature: null, fanLevel: null, verticalSwing: null, acState: null,
    todayKwh: null, monthKwh: null, daily: [], statsUnit: d.stats?.unit || null,
    stateUpdatedAt: null, statsUpdatedAt: null, error: '', statsError: '', revision: 0,
    pending: null,
  }]))
  const generations = new Map(devices.map((d) => [d.alias, 0]))
  const inFlight = new Map()
  const writing = new Set()
  ctx.effect(() => () => { active = false; lifecycle.abort() }, 'mijia-console: lifecycle')

  function patch(alias, values) {
    if (active) cache.set(alias, { ...cache.get(alias), ...values, revision: ++revision })
    return cache.get(alias)
  }
  function envelope(extra = {}) {
    const states = [...cache.values()]
    return {
      ok: true, epoch, connected: states.some((s) => s.stateUpdatedAt && !s.error),
      partial: states.some((s) => s.error || s.statsError),
      authExpired: states.some((s) => isAuthError(s.error || s.statsError)),
      updatedAt: Math.max(0, ...states.map((s) => s.stateUpdatedAt || 0)),
      devices: Object.fromEntries(states.map((s) => [s.alias, s])),
      ops: ops.list(), opsVersion: ops.version(), ...extra,
    }
  }
  function target(alias) {
    const device = devices.find((d) => d.alias === alias || d.did === alias)
    if (!device) throw new Error('目标不在米家设备白名单内')
    return device
  }

  function refresh(device, section = 'state', force = false) {
    const alias = device.alias
    const current = cache.get(alias)
    if (section === 'stats' && !device.stats) return Promise.resolve(current)
    if (section === 'state' && writing.has(alias)) return Promise.resolve(current)
    const gen = generations.get(alias)
    const key = `${alias}:${section}:${section === 'stats' ? 'shared' : gen}`
    if (inFlight.has(key)) return inFlight.get(key)
    const stamp = section === 'stats' ? (current.statsDay === beijingToday() ? current.statsUpdatedAt : null) : current.stateInvalidated ? null : current.stateUpdatedAt
    const ttl = section === 'stats' ? STATS_TTL_MS : STATE_TTL_MS
    if (!force && stamp && Date.now() - stamp < ttl) return Promise.resolve(current)
    const job = (async () => {
      try {
        const values = section === 'stats'
          ? await statisticsState(ctx, serverName, device, lifecycle.signal)
          : await deviceState(ctx, serverName, device, lifecycle.signal)
        if (!active || (section === 'state' && generations.get(alias) !== gen)) return cache.get(alias)
        patch(alias, { ...values, [section === 'stats' ? 'statsUpdatedAt' : 'stateUpdatedAt']: Date.now(), [section === 'stats' ? 'statsError' : 'error']: '', ...(section === 'state' ? { stateInvalidated: false } : { statsDay: beijingToday() }) })
        if (section === 'state') {
          const pending = cache.get(alias).pending
          if (pending) {
            const confirmed = values[pending.prop] === pending.value
            ops.update(pending.id, { status: confirmed ? 'confirmed' : pending.uncertain ? 'unknown' : 'sent', detail: confirmed ? '目标属性回读一致；空调伴侣不代表本体执行确认' : '指令已发送，回读尚未符合目标；未自动重发' })
            patch(alias, { pending: confirmed ? null : { ...pending, checking: false } })
          }
        }
      } catch (error) {
        if (active && (section === 'stats' || generations.get(alias) === gen)) {
          const message = String(error?.message || error)
          patch(alias, { [section === 'stats' ? 'statsError' : 'error']: message })
          if (section === 'state' && cache.get(alias).pending) {
            const pending = cache.get(alias).pending
            ops.update(pending.id, { detail: '指令结果待确认，状态查询失败；未自动重发' })
            patch(alias, { pending: { ...pending, checking: false } })
          }
        }
      }
      return cache.get(alias)
    })().finally(() => inFlight.delete(key))
    inFlight.set(key, job)
    return job
  }

  async function control(payload) {
    const device = target(String(payload?.alias || payload?.did || '').trim())
    const { alias } = device
    const prop = String(payload?.prop || '').trim()
    const { wire } = validateWrite(device, prop, payload?.value)
    if (writing.has(alias)) throw new Error('该设备正在发送指令，请稍后再试')
    writing.add(alias)
    generations.set(alias, generations.get(alias) + 1)
    const previous = cache.get(alias).pending
    if (previous) ops.update(previous.id, { detail: '已被后续操作取代，未自动重发' })
    const id = ops.push({ source: 'page', alias, kind: device.kind, action: `${prop} = ${wire}`, status: 'sending' })
    patch(alias, { pending: null, sending: true })
    const startedAt = Date.now()
    try {
      await callMcp(ctx, serverName, 'set_device_property', { did: device.did, prop_name: device.writable[prop].prop, value: wire }, WRITE_TIMEOUT_MS, lifecycle.signal)
      ops.update(id, { status: 'sent', detail: '接口已接收，正在后台回读目标属性' })
      patch(alias, { pending: { id, prop, value: JSON.parse(wire), checking: true }, sending: false, error: '' })
      writing.delete(alias)
      // One bounded reconciliation read survives view changes; no background polling.
      void refresh(device, 'state', true)
      return envelope({ device: cache.get(alias), accepted: true })
    } catch (error) {
      const message = String(error?.message || error)
      const uncertain = /timeout|timed out|aborted/i.test(message)
      patch(alias, { sending: false })
      ops.update(id, { status: uncertain ? 'unknown' : 'failed', detail: uncertain ? '发送超时，可能已执行；请查询状态，不要重复发送' : message })
      if (uncertain) patch(alias, { pending: { id, prop, value: JSON.parse(wire), checking: true, uncertain: true } })
      writing.delete(alias)
      if (uncertain) void refresh(device, 'state', true)
      return envelope({ ok: false, uncertain, message, device: cache.get(alias) })
    } finally {
      writing.delete(alias)
      console.info('[mijia-console]', JSON.stringify({ event: 'control.finish', alias, elapsedMs: Date.now() - startedAt }))
    }
  }

  /* Voice/chat writes invalidate just that device. A visible page picks up the change. */
  ctx.on('tools/result', (exec, result) => {
    if (!active) return
    try {
      const name = exec?.name
      if (![ `mcp__${serverName}__set_device_property`, `mcp__${serverName}__run_device_action` ].includes(name)) return
      const args = exec.arguments || {}
      const device = devices.find((d) => d.did === String(args.did ?? '') || (!args.did && [d.alias, d.label.zh].includes(args.dev_name)))
      if (!device) return
      const failed = !!result?.isError
      ops.push({ source: 'channel', alias: device.alias, kind: device.kind,
        action: name.endsWith('set_device_property') ? `${args.prop_name} = ${args.value}` : `action ${args.action_name}`,
        status: failed ? 'failed' : 'sent', detail: failed ? '语音/聊天指令失败' : '语音/聊天指令已发送，等待状态刷新',
      })
      if (!failed) {
        generations.set(device.alias, generations.get(device.alias) + 1)
        patch(device.alias, { stateInvalidated: true, pending: null })
      }
    } catch { /* Observer must not affect the voice/chat execution. */ }
  })

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact', path: ROUTE_STATE,
    handler: async (req, res) => {
      if (rejected(ctx, req, res)) return
      if (req.method !== 'GET') { sendJson(res, 405, { message: 'GET only' }); return }
      sendJson(res, 200, envelope()) // Memory only: does not wait for any cloud request.
    },
  }), 'mijia-console: state route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact', path: ROUTE_DEVICE,
    handler: async (req, res) => {
      if (rejected(ctx, req, res)) return
      if (req.method !== 'GET') { sendJson(res, 405, { message: 'GET only' }); return }
      try {
        const query = new URL(req.url, 'http://localhost').searchParams
        const device = target(query.get('alias') || '')
        const section = query.get('section') || 'state'
        if (!['state', 'stats'].includes(section)) throw new Error('未知查询类型')
        const state = await refresh(device, section, query.get('force') === '1')
        sendJson(res, 200, envelope({ device: state }))
      } catch (error) {
        sendJson(res, 400, { ok: false, message: String(error?.message || error) })
      }
    },
  }), 'mijia-console: device route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact', path: ROUTE_CONTROL,
    handler: async (req, res) => {
      if (rejected(ctx, req, res)) return
      if (req.method !== 'POST') { sendJson(res, 405, { message: 'POST only' }); return }
      let payload
      try { payload = JSON.parse(await readBody(req, MAX_BODY_BYTES)) } catch {
        sendJson(res, 400, { ok: false, message: 'invalid json' }); return
      }
      try { sendJson(res, 200, await control(payload)) }
      catch (error) { sendJson(res, 400, { ok: false, message: String(error?.message || error) }) }
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
