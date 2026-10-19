# 米家控制台（@local/mijia-console v1.1.0）

DeepSeek Harness 的米家设备可视化控制台页面。复用现有 `@local/mijia-mcp` 的 MCP 连接与凭据，不启动第二套米家服务，不改动语音助手。

## 结构

| 文件 | 作用 |
|---|---|
| `cordis.patch.yml` | 插入 Host 行 `include:mijia-console`；三台设备的 did/属性映射/可写范围/统计口径全部在此配置（YAML 中 `on` 键值必须加引号） |
| `index.js` | Host 引导（时间戳重导入 impl.mjs，改代码后禁用/启用插件行即可迭代） |
| `impl.mjs` | Host：内存快照 `GET /mijia-console/state`、单设备状态/统计 `GET /mijia-console/device`、受控写入 `POST /mijia-console/control`、素材 `GET /mijia-console/assets/<name>`；`tools/result` 观察语音/聊天写操作记入最近操作 |
| `client.js` | Client：侧边栏图标入口（`sidebar.panellist` id=`mijia-console`）+ 主面板页面（`main` key=`mijia-console`） |
| `assets/` | 用户提供的三台设备产品图 |
| `locale/` | 插件管理显示文案（zh/en） |

## 安全与真实性

- Host 逐层校验：设备白名单（alias/did）→ 属性白名单 → 类型/范围/枚举校验，不依赖前端隐藏控件
- 凭据只在后端；路由经宿主连接层鉴权（未授权请求 401）
- 灯带不提供亮度/色温等灯具控件（底层是插座）
- 空调伴侣区分"指令已发送/功率实证确认"；无室温回读能力，页面明确标注
- 缺失、非法和非有限数值显示 `--`；设备属性与用电统计各自保留上次成功值及时间，查询失败不会清空它们
- 连接状态来自真实请求结果；登录失效显示重新授权提示

## 启停

- 停用页面：插件管理禁用 `include:mijia-console`（不影响 `mijia-mcp` 的 MCP 连接与守卫）
- 页面不持有 MCP 进程；默认在页面可见时每轮完成后间隔 10s 刷新，可在设置关闭。隐藏/关闭取消前端读请求并停止自动查询；已在途的共享 Host 读取有 15s 上限，控制接收后的一次后台回读也可继续完成。
- 页面内存缓存跨面板切换保留，Host 内存缓存跨面板挂载保留；重启/重新加载插件会清空，不将设备数据写入磁盘。状态 TTL 10s，统计 TTL 5 分钟；手动刷新可强制查询，重叠请求合并。
- 写入接收后立即返回，整卡不再遮罩；后台回读必须与目标属性相等才能标记“回读一致”。超时不自动重发，旧刷新/旧操作结果不能覆盖新状态。

## 已验证 / 待验证

v1.1.0：`npm run check` 语法检查通过；`npm test` 包含真实 Host 路由和真实 React Hooks/渲染器测试（模拟网络与设备），验证缓存、独立加载、回读与写入竞态、鉴权/白名单、超时保留旧值、无 NaN、页面卸载与双击等路径。

这不等于物理设备或 Harness 实机验收。真实米家响应耗时、插件热更新后的页面效果、深色/窄窗口仍需实测。旧版实测记录在 `docs/HANDOVER.md`；本版详细边界和验收步骤见 `docs/CONSOLE-1.1.0.md`。
