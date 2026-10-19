# 米家控制台（@local/mijia-console）

DeepSeek Harness 的米家设备可视化控制台页面。复用现有 `@local/mijia-mcp` 的 MCP 连接与凭据，不启动第二套米家服务，不改动语音助手。

## 结构

| 文件 | 作用 |
|---|---|
| `cordis.patch.yml` | 插入 Host 行 `include:mijia-console`；三台设备的 did/属性映射/可写范围/统计口径全部在此配置（YAML 中 `on` 键值必须加引号） |
| `index.js` | Host 引导（时间戳重导入 impl.mjs，改代码后禁用/启用插件行即可迭代） |
| `impl.mjs` | Host：状态聚合 `GET /mijia-console/state`、受控写入 `POST /mijia-console/control`、素材 `GET /mijia-console/assets/<name>`；`tools/result` 观察语音/聊天写操作记入最近操作 |
| `client.js` | Client：侧边栏图标入口（`sidebar.panellist` id=`mijia-console`）+ 主面板页面（`main` key=`mijia-console`） |
| `assets/` | 用户提供的三台设备产品图 |
| `locale/` | 插件管理显示文案（zh/en） |

## 安全与真实性

- Host 逐层校验：设备白名单（alias/did）→ 属性白名单 → 类型/范围/枚举校验，不依赖前端隐藏控件
- 凭据只在后端；路由经宿主连接层鉴权（未授权请求 401）
- 灯带不提供亮度/色温等灯具控件（底层是插座）
- 空调伴侣区分"指令已发送/功率实证确认"；无室温回读能力，页面明确标注
- 缺失数据显示 `--`；刷新失败保留缓存并标注时间
- 连接状态来自真实请求结果；登录失效显示重新授权提示

## 启停

- 停用页面：插件管理禁用 `include:mijia-console`（不影响 `mijia-mcp` 的 MCP 连接与守卫）
- 页面不持有 MCP 进程；隐藏/关闭后无任何轮询（自动刷新为可选项，默认关闭，仅页面可见时每 30s）

## 已验证 / 待验证

已验证（自动化）：JS 语法、YAML 配置、槽位注册（panellist + main 均 active）、路由鉴权（未授权 401）、素材路由前缀匹配与目录穿越拦截、纯函数单测（统计解析/北京日桶/Wh→kWh/写入校验全通过）。

待验证（需浏览器与物理设备）：页面实际渲染、浅色/深色/窄窗口、开关与滑块交互、物理设备动作验收。
