import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { apply } from '../bundles/mijia-console/impl.mjs'

const text = (value, isError = false) => ({ content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }], isError })
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r }); return { promise, resolve } }
const settle = () => new Promise((resolve) => setImmediate(resolve))
const fixtures = [
  { alias: 'plug4', did: 'plug', kind: 'plug', props: { on: 'on-2', power: 'electric-power' }, stats: { key: '11.1', dayType: 'stat_day_v3', monthType: 'stat_month_v3', unit: 'kwh' }, writable: { on: { prop: 'on-2', type: 'bool' } } },
  { alias: 'lightbar2', did: 'light', kind: 'light', props: { on: 'on-2', brightness: 'brightness', colorTemperature: 'color-temperature' }, writable: { on: { prop: 'on-2', type: 'bool' }, brightness: { prop: 'brightness', type: 'int', min: 1, max: 100 } } },
  { alias: 'acpartner2', did: 'ac', kind: 'acpartner', props: { on: 'on', targetTemperature: 'target-temperature', power: 'electric-power' }, stats: { key: 'powerCost', dayType: 'stat_day', monthType: 'stat_month', unit: 'wh' }, writable: { on: { prop: 'on', type: 'bool' } } },
]

function harness(handler, rejection) {
  const routes = new Map(), events = new Map(), cleanups = [], calls = []
  const props = { plug: { 'on-2': false, 'electric-power': 0 }, light: { 'on-2': false, brightness: 44, 'color-temperature': 2700 }, ac: { on: false, 'target-temperature': 27, 'electric-power': 1 } }
  const ctx = {
    get: (name) => name === 'connection' ? { requestRejection: () => rejection } : undefined,
    tools: { get: (name) => ({ execute: async (args, options) => {
      const tool = name.split('__').at(-1)
      calls.push({ tool, args, signal: options.signal })
      const custom = handler?.(tool, args, props, options)
      if (custom !== undefined) return await custom
      if (tool === 'get_device_properties') return text({ ...props[args.did] })
      if (tool === 'get_statistics') return text([{ time: Math.floor(Date.now() / 1000), value: '[2]' }])
      if (tool === 'set_device_property') { props[args.did][args.prop_name] = JSON.parse(args.value); return text('ok') }
      throw new Error(`unexpected tool ${tool}`)
    } }) },
    effect: (fn) => { const cleanup = fn(); if (cleanup) cleanups.push(cleanup) },
    on: (name, fn) => events.set(name, fn),
    webServer: { register: (route) => { routes.set(route.path, route); return () => routes.delete(route.path) } },
  }
  apply(ctx, { serverName: 'mijia', devices: fixtures })
  const request = (url, method = 'GET', body) => new Promise((resolve, reject) => {
    const req = new EventEmitter()
    Object.assign(req, { method, url, destroy: () => {} })
    const res = { statusCode: 200, setHeader: () => {}, end: (raw) => resolve({ status: res.statusCode, body: raw ? JSON.parse(raw) : null }) }
    const route = routes.get(new URL(url, 'http://test').pathname)
    Promise.resolve(route.handler(req, res)).catch(reject)
    if (body !== undefined) queueMicrotask(() => { req.emit('data', Buffer.from(JSON.stringify(body))); req.emit('end') })
  })
  return { request, calls, props, events, dispose: () => cleanups.reverse().forEach((fn) => fn()) }
}
const state = (h) => h.request('/mijia-console/state').then((r) => r.body)
const refresh = (h, alias = 'plug4', section = 'state', force = true) => h.request(`/mijia-console/device?alias=${alias}&section=${section}&force=${force ? 1 : 0}`).then((r) => r.body)
const control = (h, value = true, alias = 'plug4') => h.request('/mijia-console/control', 'POST', { alias, prop: 'on', value }).then((r) => r.body)

// These exercise the real apply() implementation via the registered HTTP handlers.
test('opening the page returns all card metadata immediately without a cloud call', async () => {
  const h = harness(); const snap = await state(h)
  assert.equal(Object.keys(snap.devices).length, 3)
  assert.equal(snap.devices.plug4.on, null)
  assert.equal(h.calls.length, 0); h.dispose()
})
test('current state is independent of slow statistics and other devices', async () => {
  const gate = deferred()
  const h = harness((tool) => tool === 'get_statistics' ? gate.promise : undefined)
  const stats = refresh(h, 'plug4', 'stats')
  const snap = await refresh(h, 'lightbar2')
  assert.equal(snap.device.brightness, 44)
  assert.ok(snap.device.stateUpdatedAt)
  gate.resolve(text([])); await stats; h.dispose()
})
test('state TTL and in-flight deduplication avoid redundant cloud calls', async () => {
  const gate = deferred(); const h = harness((tool) => tool === 'get_device_properties' ? gate.promise : undefined)
  const a = refresh(h), b = refresh(h)
  await settle(); assert.equal(h.calls.length, 1)
  gate.resolve(text({ 'on-2': false, 'electric-power': 0 })); await Promise.all([a, b])
  await refresh(h, 'plug4', 'state', false)
  assert.equal(h.calls.length, 1); h.dispose()
})
test('state timeout preserves values and their last successful timestamp', async () => {
  let fail = false
  const h = harness((tool) => tool === 'get_device_properties' && fail ? Promise.reject(new Error('TimeoutError: timed out')) : undefined)
  const good = (await refresh(h)).device
  fail = true
  const bad = (await refresh(h)).device
  assert.equal(bad.on, false); assert.equal(bad.powerW, 0)
  assert.equal(bad.stateUpdatedAt, good.stateUpdatedAt)
  assert.match(bad.error, /timed out/)
  assert.equal(h.calls.length, 2, 'no hidden read retry chain'); h.dispose()
})
test('statistics failures preserve cached usage; invalid values cannot become NaN', async () => {
  let fail = false
  const h = harness((tool) => tool === 'get_statistics' && fail ? text([{ value: '[null]', time: Date.now() / 1000 }]) : undefined)
  const good = (await refresh(h, 'acpartner2', 'stats')).device
  assert.equal(good.todayKwh, 0.002)
  fail = true
  const bad = (await refresh(h, 'acpartner2', 'stats')).device
  assert.equal(bad.todayKwh, good.todayKwh)
  assert.equal(bad.statsUpdatedAt, good.statsUpdatedAt)
  assert.match(bad.statsError, /有效数值/)
  assert.ok(!JSON.stringify(bad).includes('NaN')); h.dispose()
})
test('a write acknowledges before its slow verification read and never resends', async () => {
  const gate = deferred()
  const h = harness((tool) => tool === 'get_device_properties' ? gate.promise : undefined)
  const accepted = await control(h)
  assert.equal(accepted.ok, true); assert.equal(accepted.accepted, true)
  assert.equal(accepted.device.on, null, 'target is not reported as observed truth')
  assert.equal(accepted.device.pending.value, true)
  assert.equal(accepted.ops[0].status, 'sent')
  gate.resolve(text({ 'on-2': true, 'electric-power': 32 })); await settle()
  const confirmed = await state(h)
  assert.equal(confirmed.devices.plug4.on, true)
  assert.equal(confirmed.ops[0].status, 'confirmed')
  assert.equal(h.calls.filter((c) => c.tool === 'set_device_property').length, 1); h.dispose()
})
test('readback that disagrees with the target is never labelled confirmed', async () => {
  const h = harness((tool) => tool === 'get_device_properties' ? text({ 'on-2': false, 'electric-power': 0 }) : undefined)
  await control(h); await settle()
  const snap = await state(h)
  assert.equal(snap.ops[0].status, 'sent'); assert.equal(snap.devices.plug4.pending.checking, false)
  assert.equal(h.calls.filter((c) => c.tool === 'set_device_property').length, 1); h.dispose()
})
test('MCP isError is a failed write, not a successful acknowledgement', async () => {
  const h = harness((tool) => tool === 'set_device_property' ? text('permission denied', true) : undefined)
  const result = await control(h)
  assert.equal(result.ok, false); assert.equal(result.ops[0].status, 'failed')
  assert.equal(h.calls.length, 1); h.dispose()
})
test('an old read finishing after a new command cannot roll state back', async () => {
  const old = deferred(); let reads = 0
  const h = harness((tool) => tool === 'get_device_properties' && ++reads === 1 ? old.promise : undefined)
  const stale = refresh(h)
  await settle(); await control(h); await settle()
  old.resolve(text({ 'on-2': false, 'electric-power': 0 })); await stale
  assert.equal((await state(h)).devices.plug4.on, true); h.dispose()
})
test('double writes to the same device are rejected while sending', async () => {
  const gate = deferred()
  const h = harness((tool) => tool === 'set_device_property' ? gate.promise : undefined)
  const first = control(h)
  await settle()
  assert.equal((await state(h)).devices.plug4.sending, true, 'sending survives a page remount')
  const second = await control(h, false)
  assert.equal(second.ok, false); assert.match(second.message, /正在发送/)
  assert.equal(h.calls.filter((c) => c.tool === 'set_device_property').length, 1)
  gate.resolve(text('ok')); await first; await settle()
  assert.equal((await state(h)).devices.plug4.sending, false); h.dispose()
})
test('a previous command verification cannot overwrite the next command', async () => {
  const old = deferred(); let reads = 0
  const h = harness((tool) => tool === 'get_device_properties' && ++reads === 1 ? old.promise : undefined)
  await control(h, true); await settle()
  await control(h, false); await settle()
  old.resolve(text({ 'on-2': true, 'electric-power': 32 })); await settle()
  assert.equal((await state(h)).devices.plug4.on, false); h.dispose()
})
test('ambiguous write timeout is not retried and retains unconfirmed status', async () => {
  const h = harness((tool) => tool === 'set_device_property' ? Promise.reject(new Error('TimeoutError: timed out')) : undefined)
  const result = await control(h); await settle()
  assert.equal(result.uncertain, true)
  assert.equal((await state(h)).ops[0].status, 'unknown')
  assert.equal(h.calls.filter((c) => c.tool === 'set_device_property').length, 1); h.dispose()
})
test('voice/chat invalidates only its target without discarding the last timestamp', async () => {
  const h = harness(); const good = (await refresh(h)).device
  h.props.plug['on-2'] = true
  h.events.get('tools/result')({ name: 'mcp__mijia__set_device_property', arguments: { did: 'plug', prop_name: 'on-2', value: 'true' } }, text('ok'))
  assert.equal((await state(h)).devices.plug4.stateUpdatedAt, good.stateUpdatedAt)
  const snap = await refresh(h, 'plug4', 'state', false)
  assert.equal(snap.device.on, true); assert.equal(h.calls.length, 2); h.dispose()
})
test('routes enforce the existing host authentication gate', async () => {
  const h = harness(undefined, 401)
  assert.equal((await h.request('/mijia-console/state')).status, 401)
  assert.equal((await h.request('/mijia-console/device?alias=plug4')).status, 401)
  assert.equal((await h.request('/mijia-console/control', 'POST', {})).status, 401)
  assert.equal(h.calls.length, 0); h.dispose()
})
test('host rejects unknown targets and unsupported properties before execution', async () => {
  const h = harness()
  assert.equal((await control(h, true, 'unknown')).ok, false)
  assert.equal((await h.request('/mijia-console/control', 'POST', { alias: 'plug4', prop: 'brightness', value: 50 })).status, 400)
  assert.equal((await h.request('/mijia-console/control', 'POST', { alias: 'lightbar2', prop: 'brightness', value: 101 })).status, 400)
  assert.equal(h.calls.length, 0); h.dispose()
})
test('plugin disposal aborts pending reads even if a tool ignores AbortSignal', async () => {
  const gate = deferred()
  const h = harness(() => gate.promise)
  const pending = refresh(h)
  await settle(); h.dispose()
  const snap = await pending
  assert.equal(snap.device.on, null)
  assert.equal(h.calls[0].signal.aborted, true)
  gate.resolve(text({ 'on-2': true })); await settle()
})

// Evaluate the shipped Client in a VM; expose helpers only in this test's source copy.
const source = (await readFile(new URL('../bundles/mijia-console/client.js', import.meta.url), 'utf8'))
  .replace("    return {\n      inject: ['slots', 'locale']", "    window.helpers = { mergeSnapshot, fmtKwh, StatCell };\n    return {\n      inject: ['slots', 'locale']")
const window = { __ModuleLoader__: { load: (definition) => definition.factory(() => ({ createElement: (tag, props, ...children) => ({ tag, props, children }) })) } }
vm.runInNewContext(source, { window })
const { mergeSnapshot, fmtKwh, StatCell } = window.helpers
const clientSnap = (revision, on, opsVersion = 0) => ({ epoch: '123-test', devices: { plug4: { revision, on } }, ops: [], opsVersion, updatedAt: revision })
test('client rejects old device revisions and old operation logs', () => {
  const newer = clientSnap(5, true, 4); newer.ops = ['new']
  const merged = mergeSnapshot(newer, clientSnap(3, false, 2))
  assert.equal(merged.devices.plug4.on, true); assert.equal(merged.ops[0], 'new')
})
test('client blocks a refreshing device during its write, without blocking other devices', () => {
  const old = clientSnap(1, false), next = clientSnap(2, true)
  next.devices.lightbar2 = { revision: 2, on: true }
  const merged = mergeSnapshot(old, next, new Set(['plug4']))
  assert.equal(merged.devices.plug4.on, false); assert.equal(merged.devices.lightbar2.on, true)
})
test('client handles host restart but ignores responses from the previous host epoch', () => {
  const old = clientSnap(10, false), restarted = { ...clientSnap(0, true), epoch: '124-new' }
  assert.equal(mergeSnapshot(old, restarted).devices.plug4.on, true)
  assert.equal(mergeSnapshot(restarted, old).devices.plug4.on, true)
})
test('missing and nonfinite client values display -- without approximation prefix', () => {
  for (const value of [null, undefined, NaN, Infinity, 'invalid']) assert.equal(fmtKwh(value), '--')
  assert.equal(fmtKwh(0), '0.00')
  const cell = StatCell({ value: '--', approx: true })
  assert.equal(cell.children[1].children[0], '--')
})
