import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const source = await readFile(new URL('../bundles/mijia-console/client.js', import.meta.url), 'utf8')
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r }); return { promise, resolve } }
const flush = () => new Promise((resolve) => setImmediate(resolve))
const textOf = (node) => !node ? '' : typeof node === 'string' ? node : (node.children || []).map(textOf).join(' ')

function setup() {
  const devices = Object.fromEntries([
    ['plug4', 'plug', '灯带'], ['lightbar2', 'light', '显示器挂灯'], ['acpartner2', 'acpartner', '空调伴侣'],
  ].map(([alias, kind, label]) => [alias, { alias, kind, label: { zh: label }, product: { zh: '测试设备' }, icon: '',
    on: false, powerW: 0, brightness: 44, colorTemperature: 2700, mode: 1,
    targetTemperature: 27, fanLevel: 1, verticalSwing: false,
    todayKwh: null, monthKwh: null, daily: [], pending: null,
    stateUpdatedAt: 1000, statsUpdatedAt: null, revision: 1, error: '', statsError: '',
  }]))
  const snap = { ok: true, epoch: '100-test', devices, ops: [], opsVersion: 0, updatedAt: 1000 }
  const requests = [], listeners = new Map(), timers = new Map()
  let timerId = 0, Page, dictionary, customFetch
  const document = { visibilityState: 'visible', addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: (name) => listeners.delete(name) }
  const ctx = {
    effect: (fn) => fn(),
    locale: { register: (ns, values) => { dictionary = values.zh }, bind: () => (key) => dictionary[key] || key },
    slots: { inject: (name, fn) => fn(), register: (spec, component) => { if (spec.name === 'main') Page = component } },
  }
  const window = { __ModuleLoader__: { load: (definition) => definition.factory(() => React).apply(ctx) } }
  const fetch = (url, options = {}) => {
    requests.push({ url, options })
    const custom = customFetch?.(url, options)
    const result = custom === undefined ? Promise.resolve(structuredClone(snap)) : Promise.resolve(custom)
    return new Promise((resolve, reject) => {
      const abort = () => reject(new DOMException('Aborted', 'AbortError'))
      options.signal?.addEventListener('abort', abort, { once: true })
      result.then((body) => { options.signal?.removeEventListener('abort', abort); resolve({ ok: true, json: async () => body }) }, reject)
      if (options.signal?.aborted) abort()
    })
  }
  vm.runInNewContext(source, { window, document, localStorage: { getItem: () => null, setItem: () => {} }, fetch,
    AbortSignal, AbortController, URL, console,
    setTimeout: (fn) => { const id = ++timerId; timers.set(id, fn); return id }, clearTimeout: (id) => timers.delete(id),
  })
  return { Page, snap, requests, listeners, timers, document, setFetch: (fn) => { customFetch = fn } }
}
const mount = async (h) => { let view; await act(async () => { view = TestRenderer.create(React.createElement(h.Page)); await flush() }); return view }
const cards = (view) => view.root.findAll((node) => node.props.className === 'mjc-card')
const switches = (view) => view.root.findAll((node) => node.props.role === 'switch')

// Real React mount/effect/event tests with fake transport, not an emulation of Hooks.
test('panel remount immediately retains cards while the new snapshot request is pending', async () => {
  const h = setup(); let view = await mount(h)
  assert.equal(cards(view).length, 3)
  await act(async () => view.unmount())
  assert.equal(h.timers.size, 0)
  const gate = deferred()
  h.setFetch((url) => url.endsWith('/state') ? gate.promise : undefined)
  view = await mount(h)
  assert.equal(cards(view).length, 3)
  assert.ok(textOf(view.toJSON()).includes('灯带'))
  gate.resolve(structuredClone(h.snap)); await act(flush)
  await act(async () => view.unmount())
})
test('one slow device does not prevent other cards from rendering usable state', async () => {
  const h = setup(), gate = deferred()
  h.snap.devices.acpartner2.stateUpdatedAt = null
  h.setFetch((url) => url.includes('alias=acpartner2') ? gate.promise : undefined)
  const view = await mount(h)
  assert.equal(cards(view).length, 3)
  assert.equal(switches(view)[0].props.disabled, false)
  assert.ok(textOf(view.toJSON()).includes('正在获取设备状态'))
  gate.resolve(structuredClone(h.snap)); await act(flush)
  await act(async () => view.unmount())
})
test('send acknowledgement clears busy UI before verification finishes; double click sends once', async () => {
  const h = setup(), accepted = deferred(), verified = deferred()
  let verifying = false
  h.setFetch((url, options) => {
    if (options.method === 'POST') return accepted.promise
    if (verifying && url.includes('alias=plug4')) return verified.promise
  })
  const view = await mount(h)
  const firstSwitch = switches(view)[0]
  await act(async () => { firstSwitch.props.onClick(); firstSwitch.props.onClick(); await flush() })
  assert.equal(h.requests.filter((r) => r.options.method === 'POST').length, 1)
  assert.equal(switches(view)[0].props['aria-checked'], true)
  assert.ok(textOf(view.toJSON()).includes('正在发送'))
  h.snap.devices.plug4.pending = { id: 1, prop: 'on', value: true, checking: true }
  h.snap.devices.plug4.revision = 2
  verifying = true
  accepted.resolve({ ...structuredClone(h.snap), accepted: true })
  await act(flush)
  assert.ok(!textOf(view.toJSON()).includes('正在发送'))
  assert.ok(textOf(view.toJSON()).includes('正在确认状态'))
  assert.equal(switches(view)[0].props.disabled, false)
  h.snap.devices.plug4.on = true
  h.snap.devices.plug4.pending = null
  h.snap.devices.plug4.revision = 3
  verified.resolve(structuredClone(h.snap)); await act(flush)
  assert.equal(switches(view)[0].props['aria-checked'], true)
  assert.ok(!textOf(view.toJSON()).includes('正在确认状态'))
  await act(async () => view.unmount())
})
test('hidden or unmounted panels abort reads and cannot leave a refresh timer behind', async () => {
  const h = setup(), gate = deferred()
  h.setFetch((url) => url.includes('/device?') ? gate.promise : undefined)
  const view = await mount(h)
  const reads = h.requests.filter((r) => r.url.includes('/device?'))
  assert.ok(reads.length > 0)
  h.document.visibilityState = 'hidden'
  await act(async () => { h.listeners.get('visibilitychange')(); await flush() })
  assert.ok(reads.every((r) => r.options.signal.aborted))
  const count = h.requests.length
  // A scheduled tick while hidden does no network work.
  const [timerId, tick] = h.timers.entries().next().value
  h.timers.delete(timerId)
  await act(async () => { await tick(); await flush() })
  assert.equal(h.requests.length, count)
  await act(async () => view.unmount())
  assert.equal(h.listeners.size, 0)
  assert.equal(h.timers.size, 0)
  gate.resolve(structuredClone(h.snap))
})
test('failed refresh shows cached values, a readable timeout and no NaN', async () => {
  const h = setup()
  h.snap.devices.acpartner2.error = 'TimeoutError: The operation was aborted due to timeout'
  h.snap.devices.acpartner2.todayKwh = NaN
  const view = await mount(h)
  const contents = textOf(view.toJSON())
  assert.ok(contents.includes('显示上次数据'))
  assert.ok(contents.includes('响应超时'))
  assert.ok(!contents.includes('NaN'))
  assert.ok(!contents.includes('TimeoutError'))
  await act(async () => view.unmount())
})

test('lost command transport reports an uncertain result without resending', async () => {
  const h = setup()
  h.setFetch((url, options) => options.method === 'POST' ? Promise.reject(new Error('Failed to fetch')) : undefined)
  const view = await mount(h)
  await act(async () => { switches(view)[0].props.onClick(); await flush() })
  assert.equal(h.requests.filter((r) => r.options.method === 'POST').length, 1)
  assert.ok(textOf(view.toJSON()).includes('指令可能已执行'))
  assert.ok(textOf(view.toJSON()).includes('勿重复发送'))
  assert.ok(!textOf(view.toJSON()).includes('正在发送'))
  await act(async () => view.unmount())
})
