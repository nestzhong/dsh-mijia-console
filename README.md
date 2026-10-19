# 米家控制台 for DeepSeek Harness（dsh-mijia-console）

在 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 中直接控制米家设备：MCP 接入 + 执行层设备白名单守卫 + 可视化控制台页面。**无需 Home Assistant / Docker / 虚拟机**——经 [Do1e/mijia-api](https://github.com/Do1e/mijia-api) 直连米家云端。

![控制台总览：三张设备卡片、真实状态与最近操作](docs/images/console-overview.webp)

![灯带：开关 + 实时功率 26W + 最近 7 天用电明细](docs/images/console-plug-detail.webp)

![显示器挂灯：开灯后亮度/色温滑块可调，拖动预览松手提交](docs/images/console-lightbar-on.webp)

## 功能

- **文字/语音控制**：米家 MCP server（stdio）接入 Harness，14 个工具注册为 `mcp__mijia__*`
- **执行层白名单守卫**：仅三台白名单设备可读写（did 精确匹配）；禁用场景/音箱/未识别工具；禁止 toggle，强制显式开/关
- **可视化控制台页面（v1.1.0）**：侧边栏入口 → 主面板三张设备卡片；再次打开先显示内存缓存，再分设备更新，统计不阻塞开关状态
  - 灯带（小米智能插座 4）：开关、实时功率、今日/本月用电、最近 7 天明细（无调光控件——它是插座）
  - 显示器挂灯 2：开关、亮度（1–100%）与色温（2700–6500K）滑块，拖动预览、松手提交
  - 空调伴侣 2：开关、目标温度（16–30℃）、模式/风速/摆风、实时功率、日/月用电；区分接口接收、目标属性回读与当前功率参考
- **真实数据**：全部来自米家云端接口；缺失显示 `--`；连接徽标来自真实请求结果；凭据只在后端（`~/.config/mijia-api/auth.json`），路由经宿主连接层鉴权
- **最近操作**：区分发送中、已发送、目标属性回读一致、结果待确认和失败；回读一致须实际匹配目标值，空调伴侣回读不代表空调本体已执行。语音/聊天操作经 `tools/result` 观察并使对应设备状态失效
- **轻量按需**：默认在页面可见时每轮完成后间隔 10s 刷新，可在设置关闭；状态缓存 10s，用电统计缓存 5 分钟；隐藏/关闭页面取消前端读请求并停止自动查询。已发出的控制不会因离开页面重发或撤销，Host 允许一次有时限的后台回读；MCP 进程随插件启停

## 仓库结构

```
bundles/
  mijia-mcp/       # 米家 MCP 连接（stdio）+ 执行层白名单守卫 + 系统提示词规则
  mijia-console/   # 可视化控制台页面（Host 路由 + Client 面板）
docs/
  HANDOVER.md      # 验收交接文档：安装/启停/能力矩阵/实测记录/未验证项
  CONSOLE-1.1.0.md # 控制台 v1.1.0 更新说明与验收清单
  images/          # 运行截图（v1.1.0 实拍）
tests/             # node --test 单元与 React 渲染测试（26 项）
```

## 安装

前置：macOS/Linux，[uv](https://docs.astral.sh/uv/)，DeepSeek Harness 桌面版。

```bash
# 1. 独立 Python 环境 + mijiaAPI（含 mcp 依赖）
uv venv ~/.local/share/mijia-api/venv --python 3.12
uv pip install --python ~/.local/share/mijia-api/venv/bin/python "mijiaAPI[mcp]"

# 2. 扫码登录（凭据存于 ~/.config/mijia-api/auth.json，勿外泄）
~/.local/share/mijia-api/venv/bin/mijiaAPI login
```

3. 在 Harness 插件管理中分别安装 `bundles/mijia-mcp` 与 `bundles/mijia-console` 两个本地目录。

> ⚠️ `bundles/*/cordis.patch.yml` 中的设备 did、米家名称与绝对路径是**作者自己环境的实际值**——安装前请改成你的设备（先在聊天里让助手 `list_devices` 拿到你的 did/名称）与本机路径。

## 更新与验证

v1.1.0 修复重复打开白屏等待、局部超时清空数据、控制后长时间遮罩及 `NaN` 用电显示。更新与验收步骤见 [docs/CONSOLE-1.1.0.md](docs/CONSOLE-1.1.0.md)。

开发验证（Node.js 22+，仅开发测试需要 npm 依赖）：

```bash
npm ci
npm run check
npm test
```

## 启停

- 插件管理禁用/启用 `include:mijia-api` 即停止/拉起 MCP 进程（凭据从磁盘恢复，无需重扫；token 失效时用 `mcp__mijia__login` 会话内重登）
- 禁用 `include:mijia-console` 仅关闭控制台页面，不影响文字/语音控制

## 依赖与许可

- 本仓库代码（两个 bundle）：[MIT](LICENSE)
- 运行时依赖 [mijiaAPI](https://github.com/Do1e/mijia-api)（GPL-3.0，独立 Python 进程经 MCP stdio 调用，本仓库不包含其代码）；请遵守其许可与免责条款，仅供学习交流
- 设备产品图为小米官方产品渲染图，版权归小米；仅作设备识别用途

## 实测状态

灯带与空调伴侣的**开/关闭环**均经真实设备验证（功率实证）。控制台 v1.1.0 已经真实环境验收（见上方实拍截图）：三张卡片渲染真实数据、页面开关灯带（回读一致，点亮功率 26W）、挂灯开/关（回读一致）、最近 7 天用电明细、操作日志的来源与状态标注（发送中/已发送/回读一致）。其余细节与未验证项（挂灯亮度/色温写、空调模式/温度/风速写、深浅色与窄窗口目检）见 [docs/HANDOVER.md](docs/HANDOVER.md)。用电统计口径：插座为 kWh（日/月交叉验证一致）；空调伴侣原始值按 Wh 解读（官方未确认）。
