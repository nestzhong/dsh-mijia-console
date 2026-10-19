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
    const ROUTE_DEVICE = '/mijia-console/device'
    const ROUTE_CONTROL = '/mijia-console/control'
    const ROUTE_ASSETS = '/mijia-console/assets/'
    const AUTO_REFRESH_MS = 10_000
    // Retained across panel unmounts, without a background timer or persistent credentials.
    let pageSnapshot = null

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
      'settings.autoRefresh': '自动刷新状态（每 10 秒，仅在页面可见时运行）',
      'settings.note': '用电统计每 5 分钟更新。离开页面停止自动查询，可关闭自动刷新。',
      'devices.title': '我的设备',
      'devices.count': '台设备',
      'devices.updated': '更新于',
      'devices.stale': '刷新失败，显示的是该时间的缓存数据',
      'card.on': '已开启',
      'card.off': '已关闭',
      'card.busy': '正在发送…',
      'card.checking': '指令已发送，正在确认状态…',
      'card.unconfirmed': '指令结果待确认，请刷新状态；未自动重发',
      'card.loading': '正在获取设备状态…',
      'card.deliveryUnknown': '发送连接中断，指令可能已执行；请刷新状态，勿重复发送。',
      'host.auth': '控制台连接权限已失效，请重新打开或重新连接 Harness。',
      'card.updated': '状态更新于',
      'card.statsUpdated': '用电更新于',
      'card.cached': '显示上次数据',
      'conn.partial': '部分设备更新异常',
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
      'ac.state.runningConfirmed': '检测到运行功率',
      'ac.state.onSent': '伴侣回读开启，本体状态待确认',
      'ac.state.offConfirmed': '当前为待机功率',
      'ac.state.offSent': '伴侣回读关闭，本体状态待确认',
      'ac.state.unknown': '状态未知',
      'ops.title': '最近操作',
      'ops.empty': '暂无操作记录',
      'ops.source.page': '页面',
      'ops.source.channel': '语音/聊天',
      'ops.status.confirmed': '回读一致',
      'ops.status.sending': '发送中',
      'ops.status.unknown': '结果待确认',
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
      'settings.autoRefresh': 'Refresh state every 10 s while this page is visible',
      'settings.note': 'Usage refreshes every 5 minutes. Automatic queries stop when hidden; auto refresh can be disabled.',
      'devices.title': 'My devices',
      'devices.count': 'devices',
      'devices.updated': 'Updated',
      'devices.stale': 'Refresh failed; showing cached data from that time',
      'card.on': 'On',
      'card.off': 'Off',
      'card.busy': 'Sending…',
      'card.checking': 'Command accepted; checking state…',
      'card.unconfirmed': 'Unconfirmed. Refresh status; command was not resent.',
      'card.loading': 'Loading device state…',
      'card.deliveryUnknown': 'Command connection lost; it may have executed. Refresh status; do not resend.',
      'host.auth': 'Console connection authorization expired. Reopen or reconnect Harness.',
      'card.updated': 'State updated',
      'card.statsUpdated': 'Usage updated',
      'card.cached': 'Showing last known data',
      'conn.partial': 'Some device updates failed',
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
      'ac.state.runningConfirmed': 'Operating power detected',
      'ac.state.onSent': 'Companion reads on; AC unit unconfirmed',
      'ac.state.offConfirmed': 'Standby power detected',
      'ac.state.offSent': 'Companion reads off; AC unit unconfirmed',
      'ac.state.unknown': 'Unknown',
      'ops.title': 'Recent activity',
      'ops.empty': 'No operations yet',
      'ops.source.page': 'Page',
      'ops.source.channel': 'Voice/Chat',
      'ops.status.confirmed': 'Readback matched',
      'ops.status.sending': 'Sending',
      'ops.status.unknown': 'Unconfirmed',
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
.mjc-busy { position: static; inset: auto; background: none; justify-content: flex-start; border-radius: 0; font-size: 12px; }
.mjc-meta { display: flex; gap: 6px 12px; flex-wrap: wrap; font-size: 11px; color: var(--dsw-alias-label-secondary); line-height: 1.5; }
.mjc-pending { font-size: 12px; color: var(--dsw-alias-label-secondary); line-height: 1.5; }
@media (max-width: 520px) { .mjc-inner { padding: 18px 14px 28px; } .mjc-grid { grid-template-columns: minmax(0, 1fr); } .mjc-header-actions { flex-wrap: wrap; } .mjc-pop { width: min(290px, 80vw); } .mjc-statrow { flex-wrap: wrap; } .mjc-op { gap: 6px; } }
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
    function fmtKwh(v) { return num(v) === null ? '--' : (Math.round(v * 100) / 100).toFixed(2) }

    function friendlyError(error) {
      const message = String(error?.message || error || '')
      if (/HTTP 40[13]/i.test(message)) return t('host.auth')
      if (/timeout|timed out|aborted/i.test(message)) return T('panel.title') === zh['panel.title'] ? '设备查询或指令响应超时，请刷新状态后再操作。' : 'Device request timed out. Refresh status before retrying a command.'
      if (/登录|授权|认证|auth|token|凭据/i.test(message)) return t('auth.hint')
      if (/fetch|network|HTTP 50[234]/i.test(message)) return T('panel.title') === zh['panel.title'] ? '暂时无法连接米家服务，请稍后重试。' : 'Cannot reach the Mijia service. Please try again later.'
      return message
    }

    async function apiRead(path, signal) {
      const res = await fetch(path, { cache: 'no-store', signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      if (!data || data.ok !== true) throw new Error(data?.message || `HTTP ${res.status}`)
      return data
    }
    const apiState = (signal) => apiRead(ROUTE_STATE, signal)
    const apiDevice = (alias, section, force, signal) => apiRead(`${ROUTE_DEVICE}?alias=${encodeURIComponent(alias)}&section=${section}&force=${force ? '1' : '0'}`, signal)
    async function apiControl(payload) {
      let res
      try {
        res = await fetch(ROUTE_CONTROL, {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(35_000),
        })
      } catch (error) {
        throw Object.assign(new Error(String(error?.message || error)), { uncertain: true })
      }
      let data
      try { data = await res.json() } catch {
        throw Object.assign(new Error(`HTTP ${res.status || 502}`), { uncertain: true })
      }
      if (!res.ok) throw Object.assign(new Error(data?.message || `HTTP ${res.status}`), { uncertain: res.status >= 500 })
      return data
    }

    /** Merge each device independently. A late refresh cannot replace a newer command/readback. */
    function mergeSnapshot(previous, incoming, blocked = new Set()) {
      if (!previous) return incoming
      if (previous.epoch !== incoming.epoch) {
        return Number(String(incoming.epoch).split('-')[0]) < Number(String(previous.epoch).split('-')[0]) ? previous : incoming
      }
      const devices = { ...previous.devices }
      for (const [alias, device] of Object.entries(incoming.devices || {})) {
        if (!blocked.has(alias) && (!devices[alias] || device.revision >= devices[alias].revision)) devices[alias] = device
      }
      return { ...previous, ...incoming, devices,
        ops: incoming.opsVersion >= previous.opsVersion ? incoming.ops : previous.ops,
        opsVersion: Math.max(previous.opsVersion || 0, incoming.opsVersion || 0),
        updatedAt: Math.max(previous.updatedAt || 0, incoming.updatedAt || 0),
      }
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
      const pending = device.pending
      return h('section', { className: 'mjc-card', 'aria-label': device.label.zh, 'aria-busy': busy },
        children,
        busy ? h('div', { className: 'mjc-busy', role: 'status' }, h('span', { className: 'mjc-spinner' }), t('card.busy')) : null,
        !busy && pending ? h('div', { className: 'mjc-pending', role: 'status' }, pending.checking && !pending.uncertain ? t('card.checking') : t('card.unconfirmed')) : null,
        !device.stateUpdatedAt && !error ? h('div', { className: 'mjc-note', role: 'status' }, t('card.loading')) : null,
        h('div', { className: 'mjc-meta' },
          device.stateUpdatedAt ? h('span', null, `${t('card.updated')} ${fmtTime(device.stateUpdatedAt)}${device.error ? ` · ${t('card.cached')}` : ''}`) : null,
          device.statsUpdatedAt ? h('span', null, `${t('card.statsUpdated')} ${fmtTime(device.statsUpdatedAt)}${device.statsError ? ` · ${t('card.cached')}` : ''}`) : null),
        error ? h('div', { className: 'mjc-banner err', role: 'alert' },
          h('span', null, friendlyError(error)), ' ',
          onRetry ? h('button', { type: 'button', className: 'mjc-detail-toggle', onClick: onRetry }, t('card.retry')) : null) : null)
    }

    function CardHead({ device, readFailed, onOffDisabled, onChangeOn }) {
      const shown = device.localOn ?? (device.pending?.prop === 'on' && device.pending.checking && !device.pending.uncertain ? device.pending.value : device.on)
      const on = shown === true
      return h('div', { className: 'mjc-card-head' },
        h(DeviceImage, { icon: device.icon, alt: device.label.zh }),
        h('div', null,
          h('div', { className: 'mjc-card-name' }, device.label.zh),
          h('div', { className: 'mjc-card-product' }, device.product.zh)),
        h('div', { className: 'mjc-spacer' }),
        h(Switch, {
          checked: on, disabled: onOffDisabled || (readFailed && !device.stateUpdatedAt) || shown == null, label: device.label.zh,
          onChange: (next) => onChangeOn(next),
        }))
    }

    function StatCell({ label, value, unit, approx }) {
      return h('div', { className: 'mjc-stat' },
        h('div', { className: 'k' }, label),
        h('div', { className: 'v' }, value === null || value === undefined || value === '--' || !Number.isFinite(Number(value)) ? '--' : `${approx ? '≈' : ''}${value}`,
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
        h('span', { className: 'val' }, live === null && !dragging.current ? '--' : `${shown}${unit ? ` ${unit}` : ''}`))
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
          disabled: busy || !on || !!device.error, onCommit: (v) => onControl('brightness', v),
        }),
        h(SliderRow, {
          label: t('light.ct'), value: device.colorTemperature, min: 2700, max: 6500, unit: t('unit.k'),
          disabled: busy || !on || !!device.error, onCommit: (v) => onControl('colorTemperature', v),
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
            h('button', { type: 'button', className: 'mjc-btn', disabled: busy || !!device.error || temp === null || temp <= 16, 'aria-label': '-', onClick: () => onControl('targetTemperature', temp - 1) }, '−'),
            h('div', { className: 'mjc-temp' }, temp === null ? '--' : String(temp), h('small', null, '℃')),
            h('button', { type: 'button', className: 'mjc-btn', disabled: busy || !!device.error || temp === null || temp >= 30, 'aria-label': '+', onClick: () => onControl('targetTemperature', temp + 1) }, '+'))),
        h(SelectRow, { label: t('ac.mode'), value: device.mode, options: modeOptions, disabled: busy || !!device.error || !device.stateUpdatedAt, onChange: (v) => onControl('mode', v) }),
        h(SelectRow, { label: t('ac.fan'), value: device.fanLevel, options: fanOptions, disabled: busy || !!device.error || !device.stateUpdatedAt, onChange: (v) => onControl('fanLevel', v) }),
        h('div', { className: 'mjc-row' },
          h('span', { className: 'k' }, t('ac.swing')),
          h('span', { className: 'val' }, null),
          h(Switch, { checked: device.verticalSwing === true, disabled: busy || !!device.error || device.verticalSwing == null, label: t('ac.swing'), onChange: (next) => onControl('verticalSwing', next) })),
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
      const [snap, setSnap] = useState(pageSnapshot)
      const [loading, setLoading] = useState(!pageSnapshot)
      const [refreshError, setRefreshError] = useState('')
      const [busy, setBusy] = useState({})
      const [targets, setTargets] = useState({})
      const [cardError, setCardError] = useState({})
      const [queryError, setQueryError] = useState({})
      const [settingsOpen, setSettingsOpen] = useState(false)
      const [autoRefresh, setAutoRefresh] = useState(() => {
        try { return localStorage.getItem('mjc.autoRefresh') !== '0' } catch { return true }
      })
      const mountedRef = useRef(false)
      const requestRef = useRef(new Map())
      const controllersRef = useRef(new Set())
      const writesRef = useRef(new Set())

      const applyData = useCallback((data) => {
        if (!mountedRef.current) return
        // Writes block stale snapshots only for their own device, not the rest of the page.
        const blocked = new Set(writesRef.current)
        setSnap((previous) => {
          const merged = mergeSnapshot(previous, data, blocked)
          pageSnapshot = merged
          return merged
        })
      }, [])

      const read = useCallback((key, fetcher) => {
        if (requestRef.current.has(key)) return requestRef.current.get(key)
        const controller = new AbortController()
        controllersRef.current.add(controller)
        const promise = fetcher(controller.signal).then((data) => {
          if (!controller.signal.aborted) applyData(data)
          return data
        }).finally(() => {
          controllersRef.current.delete(controller)
          if (requestRef.current.get(key) === promise) requestRef.current.delete(key)
        })
        requestRef.current.set(key, promise)
        return promise
      }, [applyData])

      const load = useCallback(async (force = false, aliasOnly = null) => {
        if (!mountedRef.current || document.visibilityState !== 'visible') return
        setLoading(true)
        try {
          const data = await read('snapshot', apiState)
          if (!mountedRef.current || document.visibilityState !== 'visible') return
          setRefreshError('')
          const aliases = aliasOnly ? [aliasOnly] : Object.keys(data.devices)
          await Promise.allSettled(aliases.flatMap((alias) => {
            if (writesRef.current.has(alias)) return []
            const sections = data.devices[alias].kind === 'light' ? ['state'] : ['state', 'stats']
            return sections.map((section) => read(`${alias}:${section}`, (signal) => apiDevice(alias, section, force, signal))
              .then(() => { if (mountedRef.current) setQueryError((prev) => ({ ...prev, [`${alias}:${section}`]: '' })) })
              .catch((error) => {
                if (error.name !== 'AbortError' && mountedRef.current) setQueryError((prev) => ({ ...prev, [`${alias}:${section}`]: friendlyError(error) }))
              }))
          }))
        } catch (error) {
          if (error.name !== 'AbortError' && mountedRef.current) setRefreshError(friendlyError(error))
        } finally {
          if (mountedRef.current) setLoading(false)
        }
      }, [read])

      useEffect(() => {
        mountedRef.current = true
        const stopReads = () => {
          for (const controller of controllersRef.current) controller.abort()
          requestRef.current.clear()
        }
        load()
        const onVis = () => {
          if (document.visibilityState === 'visible') load()
          else stopReads()
        }
        document.addEventListener('visibilitychange', onVis)
        return () => {
          mountedRef.current = false
          stopReads()
          document.removeEventListener('visibilitychange', onVis)
        }
      }, [load])

      useEffect(() => {
        if (!autoRefresh) return undefined
        // No overlapping refresh loop. Read deduplication also covers manual refreshes.
        let stopped = false
        let timer
        const tick = async () => {
          if (document.visibilityState === 'visible') await load()
          if (!stopped) timer = setTimeout(tick, AUTO_REFRESH_MS)
        }
        timer = setTimeout(tick, AUTO_REFRESH_MS)
        return () => { stopped = true; clearTimeout(timer) }
      }, [autoRefresh, load])

      const toggleAutoRefresh = (next) => {
        setAutoRefresh(next)
        try { localStorage.setItem('mjc.autoRefresh', next ? '1' : '0') } catch { /* noop */ }
      }

      const doControl = useCallback(async (alias, prop, value) => {
        if (writesRef.current.has(alias)) return
        writesRef.current.add(alias) // synchronous protection against double clicks
        setBusy((previous) => ({ ...previous, [alias]: true }))
        if (prop === 'on') setTargets((previous) => ({ ...previous, [alias]: value }))
        setCardError((previous) => ({ ...previous, [alias]: '' }))
        try {
          const result = await apiControl({ alias, prop, value })
          writesRef.current.delete(alias)
          if (!mountedRef.current) return
          applyData(result)
          if (!result.ok) setCardError((previous) => ({ ...previous, [alias]: result.uncertain
            ? (T('panel.title') === zh['panel.title'] ? '发送超时，设备可能已执行；请刷新状态，勿重复发送。' : 'Command timed out and may have executed. Refresh status; do not resend.')
            : friendlyError(result.message) }))
          // Only reads are repeated. This joins Host reconciliation, never resends the command.
          if (result.ok || result.uncertain) {
            void read(`${alias}:verify`, (signal) => apiDevice(alias, 'state', true, signal)).catch(() => {})
          }
        } catch (error) {
          if (mountedRef.current) setCardError((previous) => ({ ...previous, [alias]: error.uncertain ? t('card.deliveryUnknown') : friendlyError(error) }))
        } finally {
          writesRef.current.delete(alias)
          if (mountedRef.current) {
            setBusy((previous) => ({ ...previous, [alias]: false }))
            setTargets((previous) => { const next = { ...previous }; delete next[alias]; return next })
          }
        }
      }, [applyData, read])

      const devices = snap?.devices
      const states = Object.values(devices || {})
      const hasErrors = states.some((device) => device.error || device.statsError)
      const hasSuccess = states.some((device) => device.stateUpdatedAt && !device.error)
      const authExpired = states.some((device) => /登录|授权|认证|auth|token|凭据/i.test(device.error || device.statsError || ''))
      const conn = authExpired ? 'auth' : hasErrors ? (hasSuccess ? 'partial' : 'err') : hasSuccess ? 'ok' : loading ? 'loading' : 'err'
      const connText = t(`conn.${conn}`)
      const connTone = { loading: 'idle', ok: 'ok', partial: 'warn', err: 'err', auth: 'warn' }[conn]
      const cardProps = (alias) => ({
        device: { ...devices[alias], ...(Object.hasOwn(targets, alias) ? { localOn: targets[alias] } : {}) },
        busy: !!busy[alias] || !!devices[alias].sending,
        error: cardError[alias] || queryError[`${alias}:state`] || devices[alias].error || queryError[`${alias}:stats`] || devices[alias].statsError || '',
        onControl: (prop, value) => doControl(alias, prop, value),
        onRetry: () => { setCardError((previous) => ({ ...previous, [alias]: '' })); load(true, alias) },
      })
      const Card = { plug: PlugCard, light: LightCard, acpartner: AcCard }
      return h('div', { className: 'mjc-page' },
        h('style', null, CSS),
        h('div', { className: 'mjc-inner' },
          h('header', { className: 'mjc-header' },
            h('div', null,
              h('div', { className: 'mjc-title' }, t('panel.title')),
              h('div', { className: 'mjc-subtitle' }, t('panel.subtitle'))),
            h('div', { className: 'mjc-header-actions' },
              h('span', { className: 'mjc-conn', role: 'status' }, h('span', { className: `mjc-dot ${connTone}`, 'aria-hidden': true }), connText),
              h('button', { type: 'button', className: 'mjc-btn', onClick: () => load(true), disabled: loading }, loading ? t('refreshing') : t('refresh')),
              h('div', { className: 'mjc-settings' },
                h('button', { type: 'button', className: 'mjc-btn icon', 'aria-label': t('settings'), 'aria-expanded': settingsOpen, onClick: () => setSettingsOpen(!settingsOpen) }, '⚙'),
                settingsOpen ? h('div', { className: 'mjc-pop', role: 'dialog', 'aria-label': t('settings') },
                  h('label', null,
                    h('input', { type: 'checkbox', checked: autoRefresh, onChange: (e) => toggleAutoRefresh(e.target.checked) }),
                    h('span', null, t('settings.autoRefresh'))),
                  h('div', { className: 'mjc-note' }, t('settings.note'))) : null))),
          authExpired ? h('div', { className: 'mjc-banner warn', role: 'alert' }, t('auth.hint')) : null,
          refreshError ? h('div', { className: 'mjc-banner err', role: 'alert' }, `${t('error.title')}: ${refreshError}`) : null,
          h('div', { className: 'mjc-section-head' },
            h('div', { className: 'mjc-section-title' }, t('devices.title'), devices ? h('small', null, `${states.length} ${t('devices.count')}`) : null),
            snap?.updatedAt ? h('div', { className: 'mjc-updated' }, `${t('devices.updated')} ${fmtClock(snap.updatedAt)}`) : null),
          !snap ? h('div', { className: 'mjc-empty' }, loading ? t('conn.loading') : t('error.body')) : null,
          devices ? h('div', { className: 'mjc-grid' }, Object.keys(devices).map((alias) => h(Card[devices[alias].kind], { key: alias, ...cardProps(alias) }))) : null,
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
