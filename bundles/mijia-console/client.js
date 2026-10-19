/**
 * 米家控制台 Client：侧边栏面板入口 + 主面板页面。
 * 数据与操作全部经 Host 路由 /mijia-console/*（Host 复用现有 MCP 连接）。
 * 主题仅使用 --dsw-alias-* 令牌；浅色/深色由宿主令牌自动适配。
 */
window.__ModuleLoader__.load({
  id: '@local/mijia-console',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useRef, useCallback } = React

    const NS = 'mijia-console'
    const PANEL_ID = 'mijia-console'
    const ROUTE_STATE = '/mijia-console/state'
    const ROUTE_CONTROL = '/mijia-console/control'
    const ROUTE_ASSETS = '/mijia-console/assets/'
    const AUTO_REFRESH_MS = 30_000

    /* ---------- 文案 ---------- */
    const zh = {
      'panel.title': '米家控制台',
      'panel.subtitle': '让设备控制更直观',
      'conn.ok': '米家服务已连接',
      'conn.err': '连接异常',
      'conn.auth': '登录失效',
      'conn.loading': '连接中…',
      'auth.hint': '米家登录失效：请在聊天中让助手重新发起扫码授权（mijia login）。',
      'refresh': '刷新',
      'refreshing': '刷新中…',
      'settings': '页面设置',
      'settings.autoRefresh': '自动刷新（每 30 秒，仅在页面可见时运行）',
      'settings.note': '默认手动刷新。页面隐藏或关闭后不会继续请求。',
      'devices.title': '我的设备',
      'devices.count': '台设备',
      'devices.updated': '更新于',
      'devices.stale': '刷新失败，显示的是该时间的缓存数据',
      'card.on': '已开启',
      'card.off': '已关闭',
      'card.busy': '执行中…',
      'card.retry': '重试',
      'plug.power': '当前功率',
      'plug.today': '今日用电',
      'plug.month': '本月用电',
      'plug.detail': '用电详情',
      'plug.dailyTitle': '最近 7 天（按北京时间自然日，单位：度/kWh）',
      'plug.consumptionNote': '插座累计读数（“今日/总计”口径未经官方确认，仅供参考）',
      'light.brightness': '亮度',
      'light.ct': '色温',
      'light.offHint': '开灯后可调节亮度与色温（关灯时不下发调节指令）',
      'light.mode': '场景模式',
      'light.mode.0': '空场景',
      'light.mode.1': '电脑模式',
      'light.mode.2': '温馨模式',
      'light.mode.3': '休闲模式',
      'light.mode.4': '办公模式',
      'ac.target': '设定温度',
      'ac.targetNote': '目标温度，非室温',
      'ac.mode': '模式',
      'ac.fan': '风速',
      'ac.swing': '上下摆风',
      'ac.mode.0': '自动',
      'ac.mode.1': '制冷',
      'ac.mode.2': '除湿',
      'ac.mode.3': '制热',
      'ac.mode.4': '送风',
      'ac.fan.0': '自动',
      'ac.fan.1': '低',
      'ac.fan.2': '中',
      'ac.fan.3': '高',
      'ac.power': '当前功率',
      'ac.today': '今日用电',
      'ac.month': '本月用电',
      'ac.statsNote': '用电统计单位未经官方确认，按 Wh 口径换算为 kWh 展示',
      'ac.rawState': '伴侣回读',
      'ac.roomTemp': '室温回读：该设备不支持（ac-state 不含可确认的室温）',
      'ac.state.runningConfirmed': '运行中（功率实证）',
      'ac.state.onSent': '开机指令已发送，空调本体待确认',
      'ac.state.offConfirmed': '已关闭（功率实证）',
      'ac.state.offSent': '关机指令已发送，本体待确认',
      'ac.state.unknown': '状态未知',
      'ops.title': '最近操作',
      'ops.empty': '暂无操作记录',
      'ops.source.page': '页面',
      'ops.source.channel': '语音/聊天',
      'ops.status.confirmed': '已确认',
      'ops.status.sent': '已发送',
      'ops.status.failed': '失败',
      'unit.w': 'W',
      'unit.kwh': 'kWh',
      'unit.kwhCn': '度',
      'unit.k': 'K',
      'error.title': '加载失败',
      'error.body': '无法获取米家控制台状态。',
    }
    const en = {
      'panel.title': 'Mi Home Console',
      'panel.subtitle': 'Visual control for your devices',
      'conn.ok': 'Mijia connected',
      'conn.err': 'Connection error',
      'conn.auth': 'Authorization expired',
      'conn.loading': 'Connecting…',
      'auth.hint': 'Mijia authorization expired. Ask the assistant in chat to start QR login again.',
      'refresh': 'Refresh',
      'refreshing': 'Refreshing…',
      'settings': 'Page settings',
      'settings.autoRefresh': 'Auto refresh (every 30 s, only while this page is visible)',
      'settings.note': 'Manual refresh by default. No requests while the page is hidden or closed.',
      'devices.title': 'My devices',
      'devices.count': 'devices',
      'devices.updated': 'Updated',
      'devices.stale': 'Refresh failed; showing cached data from that time',
      'card.on': 'On',
      'card.off': 'Off',
      'card.busy': 'Working…',
      'card.retry': 'Retry',
      'plug.power': 'Power',
      'plug.today': 'Today',
      'plug.month': 'This month',
      'plug.detail': 'Usage details',
      'plug.dailyTitle': 'Last 7 days (Beijing calendar days, kWh)',
      'plug.consumptionNote': 'Plug cumulative reading (today/total semantics unconfirmed, for reference)',
      'light.brightness': 'Brightness',
      'light.ct': 'Color temperature',
      'light.offHint': 'Turn the light on to adjust brightness / color temperature',
      'light.mode': 'Scene mode',
      'light.mode.0': 'None',
      'light.mode.1': 'Computer',
      'light.mode.2': 'Warmth',
      'light.mode.3': 'Leisure',
      'light.mode.4': 'Office',
      'ac.target': 'Target temperature',
      'ac.targetNote': 'Setpoint, not room temperature',
      'ac.mode': 'Mode',
      'ac.fan': 'Fan level',
      'ac.swing': 'Vertical swing',
      'ac.mode.0': 'Auto',
      'ac.mode.1': 'Cool',
      'ac.mode.2': 'Dry',
      'ac.mode.3': 'Heat',
      'ac.mode.4': 'Fan',
      'ac.fan.0': 'Auto',
      'ac.fan.1': 'Low',
      'ac.fan.2': 'Medium',
      'ac.fan.3': 'High',
      'ac.power': 'Power',
      'ac.today': 'Today',
      'ac.month': 'This month',
      'ac.statsNote': 'Statistics unit unconfirmed by the vendor; shown as kWh converted from Wh',
      'ac.rawState': 'Companion readback',
      'ac.roomTemp': 'Room temperature readback: not supported by this device',
      'ac.state.runningConfirmed': 'Running (power-verified)',
      'ac.state.onSent': 'On-command sent; AC unit unconfirmed',
      'ac.state.offConfirmed': 'Off (power-verified)',
      'ac.state.offSent': 'Off-command sent; AC unit unconfirmed',
      'ac.state.unknown': 'Unknown',
      'ops.title': 'Recent activity',
      'ops.empty': 'No operations yet',
      'ops.source.page': 'Page',
      'ops.source.channel': 'Voice/Chat',
      'ops.status.confirmed': 'Confirmed',
      'ops.status.sent': 'Sent',
      'ops.status.failed': 'Failed',
      'unit.w': 'W',
      'unit.kwh': 'kWh',
      'unit.kwhCn': 'kWh',
      'unit.k': 'K',
      'error.title': 'Failed to load',
      'error.body': 'Could not fetch the Mi Home console state.',
    }

    let T = (key) => key

    /* ---------- 样式（仅主题令牌；深浅色由令牌适配） ---------- */
    const CSS = `
.mjc-page { height: 100%; overflow-y: auto; overflow-x: hidden; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); }
.mjc-inner { max-width: 1180px; margin: 0 auto; padding: 24px 28px 40px; }
.mjc-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.mjc-title { font-size: 22px; font-weight: 650; line-height: 1.25; }
.mjc-subtitle { margin-top: 4px; font-size: 13px; color: var(--dsw-alias-label-secondary); }
.mjc-header-actions { display: flex; align-items: center; gap: 10px; }
.mjc-conn { display: inline-flex; align-items: center; gap: 7px; font-size: 12.5px; color: var(--dsw-alias-label-secondary); padding: 6px 10px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 999px; background: var(--dsw-alias-bg-layer-1); }
.mjc-dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
.mjc-dot.ok { background: var(--dsw-alias-state-success-primary); }
.mjc-dot.err { background: var(--dsw-alias-state-error-primary); }
.mjc-dot.warn { background: var(--dsw-alias-state-warn-primary); }
.mjc-dot.idle { background: var(--dsw-alias-state-idle-primary); }
.mjc-btn { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; padding: 7px 14px; border-radius: 9px; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); cursor: pointer; transition: background .15s ease, border-color .15s ease; }
.mjc-btn:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2); }
.mjc-btn:disabled { opacity: .55; cursor: default; }
.mjc-btn.icon { padding: 7px 9px; }
.mjc-btn.primary { background: var(--dsw-alias-brand-primary); border-color: var(--dsw-alias-brand-primary); color: #fff; }
.mjc-btn.primary:hover:not(:disabled) { background: var(--dsw-alias-brand-primary); filter: brightness(1.08); }
.mjc-btn:focus-visible, .mjc-switch:focus-visible, .mjc-select:focus-visible, input[type="range"].mjc-range:focus-visible, .mjc-detail-toggle:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
.mjc-section-head { display: flex; align-items: baseline; justify-content: space-between; margin: 26px 2px 12px; gap: 12px; flex-wrap: wrap; }
.mjc-section-title { font-size: 15px; font-weight: 600; }
.mjc-section-title small { font-weight: 400; color: var(--dsw-alias-label-secondary); margin-left: 6px; font-size: 12.5px; }
.mjc-updated { font-size: 12px; color: var(--dsw-alias-label-secondary); }
.mjc-banner { margin-top: 14px; padding: 10px 14px; border-radius: 10px; font-size: 13px; border: 1px solid; }
.mjc-banner.warn { color: var(--dsw-alias-state-warn-primary); border-color: var(--dsw-alias-state-warn-primary); background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 10%, transparent); }
.mjc-banner.err { color: var(--dsw-alias-state-error-primary); border-color: var(--dsw-alias-state-error-primary); background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 8%, transparent); }
.mjc-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 16px; align-items: start; }
.mjc-card { position: relative; background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l1); border-radius: 16px; padding: 18px 18px 16px; display: flex; flex-direction: column; gap: 14px; min-width: 0; }
.mjc-card-head { display: flex; align-items: center; gap: 12px; }
.mjc-imgbox { width: 56px; height: 56px; flex: none; display: flex; align-items: center; justify-content: center; border-radius: 12px; background: var(--dsw-alias-bg-layer-2); overflow: hidden; }
.mjc-imgbox img { max-width: 100%; max-height: 100%; object-fit: contain; }
.mjc-imgbox .mjc-glyph { font-size: 26px; line-height: 1; }
.mjc-card-name { font-size: 15.5px; font-weight: 600; line-height: 1.3; }
.mjc-card-product { font-size: 12px; color: var(--dsw-alias-label-secondary); margin-top: 2px; }
.mjc-card-head .mjc-spacer { flex: 1; }
.mjc-state-line { font-size: 12.5px; color: var(--dsw-alias-label-secondary); display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.mjc-pill { display: inline-flex; align-items: center; gap: 5px; padding: 2px 9px; border-radius: 999px; font-size: 11.5px; border: 1px solid var(--dsw-alias-border-l1); }
.mjc-pill.ok { color: var(--dsw-alias-state-success-primary); border-color: color-mix(in srgb, var(--dsw-alias-state-success-primary) 45%, transparent); }
.mjc-pill.warn { color: var(--dsw-alias-state-warn-primary); border-color: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 45%, transparent); }
.mjc-switch { position: relative; width: 46px; height: 26px; border-radius: 999px; border: none; cursor: pointer; background: var(--dsw-alias-state-idle-primary); transition: background .18s ease; flex: none; padding: 0; }
.mjc-switch.on { background: var(--dsw-alias-brand-primary); }
.mjc-switch:disabled { opacity: .55; cursor: default; }
.mjc-knob { position: absolute; top: 3px; left: 3px; width: 20px; height: 20px; border-radius: 50%; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,.25); transition: transform .18s ease; }
.mjc-switch.on .mjc-knob { transform: translateX(20px); }
.mjc-bignum { font-size: 30px; font-weight: 650; font-variant-numeric: tabular-nums; }
.mjc-bignum small { font-size: 14px; font-weight: 400; color: var(--dsw-alias-label-secondary); margin-left: 4px; }
.mjc-statrow { display: flex; gap: 12px; }
.mjc-stat { flex: 1; min-width: 0; background: var(--dsw-alias-bg-layer-2); border-radius: 10px; padding: 10px 12px; }
.mjc-stat .k { font-size: 12px; color: var(--dsw-alias-label-secondary); }
.mjc-stat .v { margin-top: 3px; font-size: 17px; font-weight: 600; font-variant-numeric: tabular-nums; }
.mjc-stat .v small { font-size: 11.5px; font-weight: 400; color: var(--dsw-alias-label-secondary); margin-left: 3px; }
.mjc-detail-toggle { align-self: flex-start; background: none; border: none; padding: 2px 0; font-size: 13px; color: var(--dsw-alias-brand-primary); cursor: pointer; display: inline-flex; align-items: center; gap: 6px; }
.mjc-daily { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.mjc-daily td { padding: 5px 2px; border-top: 1px solid var(--dsw-alias-border-l1); font-variant-numeric: tabular-nums; }
.mjc-daily td:last-child { text-align: right; }
.mjc-note { font-size: 11.5px; color: var(--dsw-alias-label-secondary); line-height: 1.5; }
.mjc-row { display: flex; align-items: center; gap: 12px; }
.mjc-row .k { width: 56px; flex: none; font-size: 13px; color: var(--dsw-alias-label-secondary); }
.mjc-row .val { margin-left: auto; font-size: 13.5px; font-weight: 600; font-variant-numeric: tabular-nums; }
.mjc-range { flex: 1; min-width: 0; accent-color: var(--dsw-alias-brand-primary); height: 26px; cursor: pointer; }
.mjc-range:disabled { cursor: default; opacity: .5; }
.mjc-select { font-size: 13px; padding: 6px 10px; border-radius: 8px; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); cursor: pointer; }
.mjc-select:disabled { opacity: .55; cursor: default; }
.mjc-stepper { display: flex; align-items: center; gap: 14px; justify-content: center; }
.mjc-stepper .mjc-btn { width: 34px; height: 34px; justify-content: center; font-size: 17px; padding: 0; border-radius: 10px; }
.mjc-temp { font-size: 30px; font-weight: 650; font-variant-numeric: tabular-nums; min-width: 96px; text-align: center; }
.mjc-temp small { font-size: 14px; font-weight: 400; color: var(--dsw-alias-label-secondary); }
.mjc-busy { position: absolute; inset: 0; border-radius: 16px; background: color-mix(in srgb, var(--dsw-alias-bg-layer-1) 55%, transparent); display: flex; align-items: center; justify-content: center; font-size: 13px; color: var(--dsw-alias-label-secondary); z-index: 2; pointer-events: none; }
.mjc-spinner { width: 16px; height: 16px; border-radius: 50%; border: 2px solid var(--dsw-alias-border-l2); border-top-color: var(--dsw-alias-brand-primary); animation: mjc-spin .8s linear infinite; margin-right: 8px; }
@keyframes mjc-spin { to { transform: rotate(360deg); } }
.mjc-ops { margin-top: 8px; background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l1); border-radius: 16px; padding: 6px 18px 10px; }
.mjc-op { display: flex; align-items: center; gap: 12px; padding: 9px 0; border-top: 1px solid var(--dsw-alias-border-l1); font-size: 13px; }
.mjc-op:first-of-type { border-top: none; }
.mjc-op .time { color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; flex: none; width: 66px; }
.mjc-op .what { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mjc-op .src { flex: none; font-size: 11.5px; color: var(--dsw-alias-label-secondary); border: 1px solid var(--dsw-alias-border-l1); border-radius: 6px; padding: 1px 7px; }
.mjc-op .status { flex: none; font-size: 11.5px; display: inline-flex; align-items: center; gap: 5px; }
.mjc-op .status.confirmed { color: var(--dsw-alias-state-success-primary); }
.mjc-op .status.sent { color: var(--dsw-alias-state-warn-primary); }
.mjc-op .status.failed { color: var(--dsw-alias-state-error-primary); }
.mjc-settings { position: relative; }
.mjc-pop { position: absolute; right: 0; top: calc(100% + 8px); z-index: 30; width: 290px; background: var(--dsw-alias-bg-overlay); border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px; padding: 14px; box-shadow: 0 10px 32px rgba(0,0,0,.18); }
.mjc-pop label { display: flex; gap: 8px; align-items: flex-start; font-size: 13px; cursor: pointer; line-height: 1.5; }
.mjc-pop .mjc-note { margin-top: 8px; }
.mjc-empty { padding: 18px 4px; font-size: 13px; color: var(--dsw-alias-label-secondary); }
@media (prefers-reduced-motion: reduce) { .mjc-switch, .mjc-knob, .mjc-btn { transition: none; } .mjc-spinner { animation-duration: 2s; } }
`

    /* ---------- 工具 ---------- */
    function t(key) { return T(key) }
    function fmtTime(ts) {
      const d = new Date(ts)
      const p = (n) => String(n).padStart(2, '0')
      return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
    }
    function fmtClock(ts) {
      const d = new Date(ts)
      const p = (n) => String(n).padStart(2, '0')
      return `${p(d.getHours())}:${p(d.getMinutes())}`
    }
    function num(v) { return typeof v === 'number' && Number.isFinite(v) ? v : null }
    function fmtKwh(v) { return v === null ? '--' : (Math.round(v * 100) / 100).toFixed(2) }

    async function apiState() {
      const res = await fetch(ROUTE_STATE, { cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      if (!data || data.ok !== true) throw new Error((data && data.message) || 'bad response')
      return data
    }
    async function apiControl(payload) {
      const res = await fetch(ROUTE_CONTROL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.json()
    }

    /* ---------- 基础控件 ---------- */
    function Switch({ checked, disabled, label, onChange }) {
      return h('button', {
        type: 'button', role: 'switch', 'aria-checked': checked === true, 'aria-label': label,
        disabled, className: 'mjc-switch' + (checked === true ? ' on' : ''),
        onClick: () => onChange(!(checked === true)),
      }, h('span', { className: 'mjc-knob' }))
    }

    function DeviceImage({ icon, alt }) {
      const [failed, setFailed] = useState(false)
      if (!icon || failed) return h('div', { className: 'mjc-imgbox', 'aria-hidden': true }, h('span', { className: 'mjc-glyph' }, '▣'))
      return h('div', { className: 'mjc-imgbox' },
        h('img', { src: ROUTE_ASSETS + icon, alt, loading: 'lazy', onError: () => setFailed(true) }))
    }

    function CardShell({ device, busy, error, onRetry, children }) {
      const label = device ? device.label.zh : ''
      return h('section', { className: 'mjc-card', 'aria-label': label },
        busy ? h('div', { className: 'mjc-busy', 'aria-live': 'polite' }, h('span', { className: 'mjc-spinner' }), t('card.busy')) : null,
        error ? h('div', { className: 'mjc-banner err', role: 'alert' },
          h('span', null, error), ' ',
          onRetry ? h('button', { type: 'button', className: 'mjc-detail-toggle', onClick: onRetry }, t('card.retry')) : null) : null,
        children)
    }

    function CardHead({ device, readFailed, onOffDisabled, onChangeOn }) {
      const on = device && device.on === true
      return h('div', { className: 'mjc-card-head' },
        h(DeviceImage, { icon: device.icon, alt: device.label.zh }),
        h('div', null,
          h('div', { className: 'mjc-card-name' }, device.label.zh),
          h('div', { className: 'mjc-card-product' }, device.product.zh)),
        h('div', { className: 'mjc-spacer' }),
        h(Switch, {
          checked: on, disabled: onOffDisabled || readFailed, label: device.label.zh,
          onChange: (next) => onChangeOn(next),
        }))
    }

    function StatCell({ label, value, unit, approx }) {
      return h('div', { className: 'mjc-stat' },
        h('div', { className: 'k' }, label),
        h('div', { className: 'v' }, value === null || value === undefined ? '--' : `${approx ? '≈' : ''}${value}`,
          unit ? h('small', null, unit) : null))
    }

    function SliderRow({ label, value, min, max, step, unit, disabled, onCommit }) {
      const live = num(value)
      const [draft, setDraft] = useState(live)
      const dragging = useRef(false)
      useEffect(() => { if (!dragging.current) setDraft(live) }, [live])
      const commit = (v) => {
        dragging.current = false
        const next = Math.round(v)
        if (live === null || next !== live) onCommit(next)
      }
      const shown = draft === null || draft === undefined ? (live ?? min) : draft
      return h('div', { className: 'mjc-row' },
        h('span', { className: 'k' }, label),
        h('input', {
          type: 'range', className: 'mjc-range', min, max, step: step || 1, value: shown,
          disabled, 'aria-label': label,
          onChange: (e) => { dragging.current = true; setDraft(Number(e.target.value)) },
          onPointerUp: (e) => commit(Number(e.target.value)),
          onKeyUp: (e) => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key)) commit(Number(e.target.value)) },
          onBlur: (e) => { if (dragging.current) commit(Number(e.target.value)) },
        }),
        h('span', { className: 'val' }, `${shown}${unit ? ` ${unit}` : ''}`))
    }

    function SelectRow({ label, value, options, disabled, onChange }) {
      return h('div', { className: 'mjc-row' },
        h('span', { className: 'k' }, label),
        h('span', { className: 'val' }, null),
        h('select', {
          className: 'mjc-select', value: value === null || value === undefined ? '' : String(value),
          disabled, 'aria-label': label,
          onChange: (e) => { if (e.target.value !== '') onChange(Number(e.target.value)) },
        },
          value === null || value === undefined ? h('option', { value: '' }, '--') : null,
          options.map((o) => h('option', { key: o.value, value: String(o.value) }, o.label))))
    }

    /* ---------- 设备卡片 ---------- */
    function PlugCard({ device, busy, error, onControl, onRetry }) {
      const [detailOpen, setDetailOpen] = useState(false)
      const daily = Array.isArray(device.daily) ? device.daily : []
      return h(CardShell, { device, busy, error, onRetry },
        h(CardHead, { device, readFailed: !!device.error, onOffDisabled: busy, onChangeOn: (next) => onControl('on', next) }),
        h('div', null,
          h('div', { className: 'mjc-state-line' }, t('plug.power')),
          h('div', { className: 'mjc-bignum' }, num(device.powerW) === null ? '--' : String(Math.round(device.powerW)), h('small', null, t('unit.w')))),
        h('div', { className: 'mjc-statrow' },
          h(StatCell, { label: t('plug.today'), value: device.todayKwh == null ? null : fmtKwh(device.todayKwh), unit: `${t('unit.kwh')}（${t('unit.kwhCn')}）` }),
          h(StatCell, { label: t('plug.month'), value: device.monthKwh == null ? null : fmtKwh(device.monthKwh), unit: `${t('unit.kwh')}（${t('unit.kwhCn')}）` })),
        daily.length
          ? h('div', null,
              h('button', { type: 'button', className: 'mjc-detail-toggle', 'aria-expanded': detailOpen, onClick: () => setDetailOpen(!detailOpen) },
                t('plug.detail'), h('span', { 'aria-hidden': true }, detailOpen ? '▾' : '▸')),
              detailOpen ? h('div', null,
                h('div', { className: 'mjc-note', style: { margin: '6px 0 2px' } }, t('plug.dailyTitle')),
                h('table', { className: 'mjc-daily' }, h('tbody', null,
                  daily.map((d) => h('tr', { key: d.date }, h('td', null, d.date), h('td', null, `${fmtKwh(d.kwh)} kWh`))))),
                num(device.consumption) !== null ? h('div', { className: 'mjc-note', style: { marginTop: 8 } }, `${t('plug.consumptionNote')}: ${device.consumption}`) : null) : null)
          : null)
    }

    function LightCard({ device, busy, error, onControl, onRetry }) {
      const on = device.on === true
      const modeLabel = num(device.mode) !== null ? t(`light.mode.${device.mode}`) : '--'
      return h(CardShell, { device, busy, error, onRetry },
        h(CardHead, { device, readFailed: !!device.error, onOffDisabled: busy, onChangeOn: (next) => onControl('on', next) }),
        h('div', { className: 'mjc-state-line' },
          h('span', { className: 'mjc-pill' }, `${t('light.mode')}: ${modeLabel}`)),
        h(SliderRow, {
          label: t('light.brightness'), value: device.brightness, min: 1, max: 100, unit: '%',
          disabled: busy || !on, onCommit: (v) => onControl('brightness', v),
        }),
        h(SliderRow, {
          label: t('light.ct'), value: device.colorTemperature, min: 2700, max: 6500, unit: t('unit.k'),
          disabled: busy || !on, onCommit: (v) => onControl('colorTemperature', v),
        }),
        !on ? h('div', { className: 'mjc-note' }, t('light.offHint')) : null)
    }

    function acStatus(device) {
      const p = num(device.powerW)
      if (device.on === true) {
        if (p !== null && p > 50) return 'runningConfirmed'
        return 'onSent'
      }
      if (device.on === false) {
        if (p !== null && p < 10) return 'offConfirmed'
        return 'offSent'
      }
      return 'unknown'
    }

    function AcCard({ device, busy, error, onControl, onRetry }) {
      const status = acStatus(device)
      const statusTone = status === 'runningConfirmed' || status === 'offConfirmed' ? 'ok' : 'warn'
      const temp = num(device.targetTemperature)
      const modeOptions = [0, 1, 2, 3, 4].map((v) => ({ value: v, label: t(`ac.mode.${v}`) }))
      const fanOptions = [0, 1, 2, 3].map((v) => ({ value: v, label: t(`ac.fan.${v}`) }))
      return h(CardShell, { device, busy, error, onRetry },
        h(CardHead, { device, readFailed: !!device.error, onOffDisabled: busy, onChangeOn: (next) => onControl('on', next) }),
        h('div', { className: 'mjc-state-line' },
          h('span', { className: `mjc-pill ${statusTone}` }, t(`ac.state.${status}`)),
          device.acState ? h('span', null, `${t('ac.rawState')}: ${device.acState}`) : null),
        h('div', null,
          h('div', { className: 'mjc-state-line', style: { marginBottom: 6 } }, t('ac.target'), h('span', { className: 'mjc-note' }, t('ac.targetNote'))),
          h('div', { className: 'mjc-stepper' },
            h('button', { type: 'button', className: 'mjc-btn', disabled: busy || temp === null || temp <= 16, 'aria-label': '-', onClick: () => onControl('targetTemperature', temp - 1) }, '−'),
            h('div', { className: 'mjc-temp' }, temp === null ? '--' : String(temp), h('small', null, '℃')),
            h('button', { type: 'button', className: 'mjc-btn', disabled: busy || temp === null || temp >= 30, 'aria-label': '+', onClick: () => onControl('targetTemperature', temp + 1) }, '+'))),
        h(SelectRow, { label: t('ac.mode'), value: device.mode, options: modeOptions, disabled: busy, onChange: (v) => onControl('mode', v) }),
        h(SelectRow, { label: t('ac.fan'), value: device.fanLevel, options: fanOptions, disabled: busy, onChange: (v) => onControl('fanLevel', v) }),
        h('div', { className: 'mjc-row' },
          h('span', { className: 'k' }, t('ac.swing')),
          h('span', { className: 'val' }, null),
          h(Switch, { checked: device.verticalSwing === true, disabled: busy, label: t('ac.swing'), onChange: (next) => onControl('verticalSwing', next) })),
        h('div', { className: 'mjc-statrow' },
          h(StatCell, { label: t('ac.power'), value: num(device.powerW) === null ? null : String(Math.round(device.powerW)), unit: t('unit.w') }),
          h(StatCell, { label: t('ac.today'), value: device.todayKwh == null ? null : fmtKwh(device.todayKwh), unit: t('unit.kwh'), approx: true }),
          h(StatCell, { label: t('ac.month'), value: device.monthKwh == null ? null : fmtKwh(device.monthKwh), unit: t('unit.kwh'), approx: true })),
        h('div', { className: 'mjc-note' }, t('ac.statsNote')),
        h('div', { className: 'mjc-note' }, t('ac.roomTemp')))
    }

    /* ---------- 最近操作 ---------- */
    function OpsList({ ops, devices }) {
      const labelOf = (alias) => (devices && devices[alias] && devices[alias].label.zh) || alias || '--'
      return h('section', { className: 'mjc-ops', 'aria-label': t('ops.title') },
        h('div', { className: 'mjc-section-head', style: { margin: '10px 2px 4px' } },
          h('div', { className: 'mjc-section-title' }, t('ops.title'))),
        !ops || !ops.length
          ? h('div', { className: 'mjc-empty' }, t('ops.empty'))
          : ops.map((op, i) => h('div', { className: 'mjc-op', key: `${op.ts}-${i}` },
              h('span', { className: 'time' }, fmtTime(op.ts)),
              h('span', { className: 'what' }, `${labelOf(op.alias)} · ${op.action}`),
              h('span', { className: 'src' }, op.source === 'page' ? t('ops.source.page') : t('ops.source.channel')),
              h('span', { className: `status ${op.status}`, title: op.detail || undefined }, t(`ops.status.${op.status}`)))))
    }

    /* ---------- 页面 ---------- */
    function ConsolePage() {
      const [snap, setSnap] = useState(null)
      const [loading, setLoading] = useState(true)
      const [refreshError, setRefreshError] = useState('')
      const [busy, setBusy] = useState({})
      const [cardError, setCardError] = useState({})
      const [settingsOpen, setSettingsOpen] = useState(false)
      const [autoRefresh, setAutoRefresh] = useState(() => {
        try { return localStorage.getItem('mjc.autoRefresh') === '1' } catch { return false }
      })
      const seqRef = useRef({})
      const mountedRef = useRef(true)
      const snapRef = useRef(null)
      useEffect(() => { snapRef.current = snap }, [snap])

      const load = useCallback(async () => {
        try {
          const data = await apiState()
          if (!mountedRef.current) return
          setSnap(data)
          setRefreshError('')
          setCardError({})
        } catch (error) {
          if (!mountedRef.current) return
          setRefreshError(String((error && error.message) || error))
        } finally {
          if (mountedRef.current) setLoading(false)
        }
      }, [])

      useEffect(() => {
        mountedRef.current = true
        load()
        const onVis = () => { if (document.visibilityState === 'visible') load() }
        document.addEventListener('visibilitychange', onVis)
        return () => {
          mountedRef.current = false
          document.removeEventListener('visibilitychange', onVis)
        }
      }, [load])

      useEffect(() => {
        if (!autoRefresh) return undefined
        const timer = setInterval(() => { if (document.visibilityState === 'visible') load() }, AUTO_REFRESH_MS)
        return () => clearInterval(timer)
      }, [autoRefresh, load])

      const toggleAutoRefresh = (next) => {
        setAutoRefresh(next)
        try { localStorage.setItem('mjc.autoRefresh', next ? '1' : '0') } catch { /* noop */ }
      }

      const doControl = useCallback(async (alias, prop, value) => {
        const seq = (seqRef.current[alias] || 0) + 1
        seqRef.current[alias] = seq
        setBusy((b) => ({ ...b, [alias]: true }))
        setCardError((e) => ({ ...e, [alias]: '' }))
        // 开关 optimistic：立即反映目标位置；失败回滚。空调伴侣类由状态角标继续标注"待确认"，不伪装已执行。
        const prevDevice = prop === 'on' && snapRef.current ? snapRef.current.devices[alias] : null
        if (prevDevice) {
          setSnap((s) => (s ? { ...s, devices: { ...s.devices, [alias]: { ...prevDevice, on: value === true } } } : s))
        }
        const revert = (ops) => {
          if (prevDevice) setSnap((s) => (s ? { ...s, devices: { ...s.devices, [alias]: prevDevice }, ops: ops || s.ops } : s))
          else if (ops) setSnap((s) => (s ? { ...s, ops } : s))
        }
        try {
          const res = await apiControl({ alias, prop, value })
          if (seqRef.current[alias] !== seq || !mountedRef.current) return // 迟到响应丢弃
          if (!res || res.ok !== true) {
            setCardError((e) => ({ ...e, [alias]: String((res && res.message) || 'unknown error') }))
            revert(res && res.ops)
            return
          }
          setSnap((s) => {
            if (!s) return s
            // 浅合并：快速回读省略统计键，保留旧统计值；回读失败（device.error）保留当前显示，等待手动刷新
            const merged = res.device && !res.device.error
              ? { ...(s.devices[alias] || {}), ...res.device }
              : s.devices[alias]
            return { ...s, devices: { ...s.devices, [alias]: merged }, ops: res.ops || s.ops, updatedAt: res.updatedAt || s.updatedAt }
          })
        } catch (error) {
          if (seqRef.current[alias] !== seq || !mountedRef.current) return
          revert()
          setCardError((e) => ({ ...e, [alias]: String((error && error.message) || error) }))
        } finally {
          if (seqRef.current[alias] === seq && mountedRef.current) setBusy((b) => ({ ...b, [alias]: false }))
        }
      }, [])

      const devices = snap ? snap.devices : null
      const conn = loading && !snap ? 'loading' : !snap ? 'err' : snap.authExpired ? 'auth' : snap.connected ? 'ok' : 'err'
      const connText = { loading: t('conn.loading'), ok: t('conn.ok'), err: t('conn.err'), auth: t('conn.auth') }[conn]
      const connTone = { loading: 'idle', ok: 'ok', err: 'err', auth: 'warn' }[conn]

      const cardProps = (alias) => ({
        device: devices[alias],
        busy: !!busy[alias],
        error: cardError[alias] || (devices[alias] && devices[alias].error) || '',
        onControl: (prop, value) => doControl(alias, prop, value),
        onRetry: load,
      })

      return h('div', { className: 'mjc-page' },
        h('style', null, CSS),
        h('div', { className: 'mjc-inner' },
          h('header', { className: 'mjc-header' },
            h('div', null,
              h('div', { className: 'mjc-title' }, t('panel.title')),
              h('div', { className: 'mjc-subtitle' }, t('panel.subtitle'))),
            h('div', { className: 'mjc-header-actions' },
              h('span', { className: 'mjc-conn', role: 'status' }, h('span', { className: `mjc-dot ${connTone}`, 'aria-hidden': true }), connText),
              h('button', { type: 'button', className: 'mjc-btn', onClick: load, disabled: loading && !snap }, loading && !snap ? t('refreshing') : t('refresh')),
              h('div', { className: 'mjc-settings' },
                h('button', { type: 'button', className: 'mjc-btn icon', 'aria-label': t('settings'), 'aria-expanded': settingsOpen, onClick: () => setSettingsOpen(!settingsOpen) }, '⚙'),
                settingsOpen ? h('div', { className: 'mjc-pop', role: 'dialog', 'aria-label': t('settings') },
                  h('label', null,
                    h('input', { type: 'checkbox', checked: autoRefresh, onChange: (e) => toggleAutoRefresh(e.target.checked) }),
                    h('span', null, t('settings.autoRefresh'))),
                  h('div', { className: 'mjc-note' }, t('settings.note'))) : null))),
          snap && snap.authExpired ? h('div', { className: 'mjc-banner warn', role: 'alert' }, t('auth.hint')) : null,
          refreshError ? h('div', { className: 'mjc-banner err', role: 'alert' }, `${t('error.title')}: ${refreshError}`) : null,
          h('div', { className: 'mjc-section-head' },
            h('div', { className: 'mjc-section-title' }, t('devices.title'), devices ? h('small', null, `3 ${t('devices.count')}`) : null),
            snap ? h('div', { className: 'mjc-updated' },
              `${t('devices.updated')} ${fmtClock(snap.updatedAt)}`,
              refreshError ? ` · ${t('devices.stale')}` : '') : null),
          !snap && loading ? h('div', { className: 'mjc-empty' }, t('conn.loading')) : null,
          !snap && !loading ? h('div', { className: 'mjc-empty' }, t('error.body')) : null,
          devices ? h('div', { className: 'mjc-grid' },
            h(PlugCard, cardProps('plug4')),
            h(LightCard, cardProps('lightbar2')),
            h(AcCard, cardProps('acpartner2'))) : null,
          snap ? h(OpsList, { ops: snap.ops, devices }) : null))
    }

    /* ---------- 侧边栏面板图标 ---------- */
    function PanelIcon({ size, active }) {
      const s = typeof size === 'number' ? size : 20
      const color = active ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-label-secondary)'
      return h('svg', {
        viewBox: '0 0 24 24', width: s, height: s, 'aria-hidden': true,
        style: { display: 'block', color },
      },
        h('path', { d: 'M4 11.5 12 5l8 6.5', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
        h('path', { d: 'M6.5 10.5V19h11v-8.5', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
        h('path', { d: 'M10.6 13.2v1.6M13.4 13.2v1.6M9.8 14.8h4.4v1.2a2.2 2.2 0 0 1-4.4 0v-1.2z', fill: 'currentColor' }))
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'mijia-console: dictionaries')
        T = ctx.locale.bind(NS)
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist', id: PANEL_ID, order: 5, locale: NS, label: () => T('panel.title'),
        }, PanelIcon))
        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main', key: PANEL_ID, locale: NS,
        }, ConsolePage))
      },
    }
  },
})
