/**
 * 米家设备白名单守卫（Host 插件）。
 *
 * 对 mijia MCP 服务器（serverName 见 config）注册的工具做执行层拦截：
 * - 登录/列表/规格查询类工具直接放行（只读、无设备目标）；
 * - 设备相关工具（get_device_properties / get_statistics / set_device_property /
 *   run_device_action）仅放行白名单内的设备（按 did 精确匹配，dev_name 次之）；
 * - run_device_action 禁止 toggle 动作（要求显式开/关）；
 * - run_scene / run_speaker_command / speaker_play 一律拒绝（可越权控制其他设备）；
 * - 未识别的 mcp__<serverName>__* 工具一律拒绝（fail-closed）。
 *
 * 同时向系统提示词注入米家设备使用规则（别名 ↔ did 对照与执行规范）。
 */

const FREE_TOOLS = new Set([
	"login",
	"login_status",
	"list_homes",
	"list_devices",
	"list_scenes",
	"list_consumables",
	"get_device_spec",
]);
const TARGETED_TOOLS = new Set([
	"get_device_properties",
	"get_statistics",
	"set_device_property",
	"run_device_action",
]);
const DENIED_TOOLS = new Set(["run_scene", "run_speaker_command", "speaker_play"]);
const WRITE_TOOLS = new Set(["set_device_property", "run_device_action"]);

function normalizeDevices(config) {
	const raw = config?.devices;
	if (!Array.isArray(raw)) throw new Error("mijia-device-guard: config.devices must be an array");
	return raw.map((entry, index) => {
		if (typeof entry !== "object" || entry === null) throw new Error(`mijia-device-guard: devices[${index}] must be an object`);
		const did = entry.did === void 0 || entry.did === null ? "" : String(entry.did).trim();
		const alias = String(entry.alias ?? "").trim();
		const label = String(entry.label ?? "").trim();
		const names = Array.isArray(entry.names) ? entry.names.map((name) => String(name).trim()).filter(Boolean) : [];
		if (!did) throw new Error(`mijia-device-guard: devices[${index}] (${alias || "?"}) is missing a non-empty did`);
		if (!alias) throw new Error(`mijia-device-guard: devices[${index}] is missing an alias`);
		return { alias, label, did, names };
	});
}

function resolveTarget(args, devices) {
	/** 返回 { device } 命中、{ reason } 拒绝。did 优先，dev_name 精确匹配次之。 */
	const did = typeof args.did === "string" || typeof args.did === "number" ? String(args.did).trim() : "";
	const devName = typeof args.dev_name === "string" ? args.dev_name.trim() : "";
	if (did) {
		const device = devices.find((entry) => entry.did === did);
		if (device) return { device };
		return { reason: `did "${did}" 不在米家白名单内，已拒绝。` };
	}
	if (devName) {
		const device = devices.find((entry) => entry.names.includes(devName) || entry.alias === devName || entry.label === devName);
		if (device) return { device };
		return { reason: `设备名称 "${devName}" 不在米家白名单内，已拒绝。` };
	}
	return { reason: "必须提供白名单设备的 did 或 dev_name，已拒绝。" };
}

function buildRules(serverName, devices) {
	const lines = devices.map((device, index) => {
		const names = device.names.length ? `，米家名称 ${device.names.map((name) => `「${name}」`).join("/")}` : "";
		return `${index + 1}. ${device.label || device.alias} — 别名 \`${device.alias}\`，did \`${device.did}\`${names}`;
	});
	return `## 米家设备控制规则（MCP server: ${serverName}）

只允许操作以下 ${devices.length} 台白名单设备（按别名/did 精确匹配，执行层已拒绝其他设备）：
${lines.join("\n")}

执行规则：
- 优先用 did 指定设备；米家名称与别名可能不同或被用户改过，严禁凭名称猜测目标。
- 开/关使用 set_device_property(prop_name="on", value="true"/"false")；禁止使用 toggle 类动作。
- 控制调用超时或结果不明时，先 get_device_properties 查询当前状态再决定是否重试，不要盲目重复执行。
- 查询结果必须标注单位、统计时间范围与数据新鲜度；取不到数据时如实说明，不要编造。
- 经云端/网关转发的设备（如空调伴侣类红外设备）：set/run 返回成功仅表示指令已发送，不等于本体已执行；需要确认时用 get_device_properties 回读并如实说明。
- 场景（run_scene）与小爱音箱（run_speaker_command / speaker_play）能力已被禁用。
- 以上设备之外的其他米家设备不在本批开放范围，发现用户要求操作时应明确拒绝并说明。`;
}

export const inject = ["tools"];

export function apply(ctx, config) {
	const serverName = typeof config?.serverName === "string" && config.serverName.trim() ? config.serverName.trim() : "mijia";
	const devices = normalizeDevices(config);
	const prefix = `mcp__${serverName}__`;
	const allowListText = devices.map((device) => `${device.label || device.alias}（别名 ${device.alias}）`).join("、");

	ctx.effect(
		() =>
			ctx.tools.guard((execution) => {
				if (!execution.name.startsWith(prefix)) return;
				const rawName = execution.name.slice(prefix.length);
				if (DENIED_TOOLS.has(rawName)) return `米家工具 ${rawName} 已被本机策略禁用（可绕过设备白名单），已拒绝。`;
				if (FREE_TOOLS.has(rawName)) return;
				if (!TARGETED_TOOLS.has(rawName)) return `未知米家工具 ${rawName}，按默认拒绝策略处理。`;
				const args = typeof execution.arguments === "object" && execution.arguments !== null ? execution.arguments : {};
				const target = resolveTarget(args, devices);
				if (target.reason) return `${target.reason}当前仅开放：${allowListText || "（无）"}。`;
				if (rawName === "run_device_action") {
					const actionName = typeof args.action_name === "string" ? args.action_name.trim().toLowerCase() : "";
					if (actionName === "toggle") return "禁止使用 toggle 动作，请改用 set_device_property 显式设置 on=true/false。";
				}
				return;
			}),
		"mijia-device-guard.whitelist",
	);

	ctx.inject(["systemPrompt"], (inner) => {
		inner.systemPrompt.section({
			name: "mijia-device-rules",
			order: inner.systemPrompt.getSectionOrder("MCP_SERVERS"),
			interpolate: false,
			text: () => buildRules(serverName, devices),
		});
	});
}
