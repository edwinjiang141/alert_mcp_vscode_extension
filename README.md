# OEM Assistant for VS Code

一个面向“告警查询与处理”场景的专用 VS Code 插件骨架。

> 本文档已同步当前版本的**功能实现现状**与**已修复问题**，可直接作为客户演示/MVP 方案说明。

---

## 0. 当前版本实现总结（MVP 可落地）

### 0.1 已完成的核心能力

1. **独立 Settings 界面（Webview）**
   - 提供独立设置页，集中维护 MCP / LLM / OEM 配置。
   - 支持：
     - MCP SSE 地址与连接模式
     - LLM Provider / Base URL / Model / Temperature
     - OEM Base URL / Username
     - LLM API Key / MCP Token / OEM Password（密码类走 SecretStorage）

2. **MCP 连接与工具发现**
   - 支持 `auto / legacy-sse / streamable-http` 三种连接模式。
   - `auto` 模式会优先 Streamable HTTP，失败后回退 SSE。
   - Sidebar 展示连接状态、模型信息、可用工具列表与数量。

3. **控制台对话能力（Cline 风格 MVP）**
   - 保留输入框 + 提交按钮的对话体验。
   - 支持执行轨迹（Tool Execution Trace）展示。
   - 支持平滑打字机输出效果。
   - 对敏感信息进行前后端脱敏，避免凭据泄露。

4. **`@tool` 选择与调用编排**
   - 输入 `@` 会弹出工具列表，支持模糊检索、键盘上下选择、回车插入。
   - 支持多 `@tool` 顺序执行（按输入顺序）。
   - 支持单 `@tool` 直接执行（不再依赖 LLM 是否愿意发起 tool_call）。

5. **OEM 登录自动化**
   - 输入“登录OEM”或 `@oem_login` 时，优先走直接登录流程。
   - 自动从 settings + SecretStorage 注入 OEM 凭据，不再反问账号密码。
   - 提取并复用 `session_id`，用于后续工具调用认证。

6. **会话上下文（128KB）**
   - 单会话历史上下文缓存（上限 128KB）。
   - 超限会自动裁剪最早历史，MCP 断开时清空会话上下文。

7. **打包与构建稳定性**
   - 修复 `@cfworker/json-schema` 依赖解析问题（esbuild alias + shim）。
   - `npm run package` 先 build 再 vsce package，支持快速产物演示。

---

### 0.2 已修复的关键问题（按能力归类）

1. **Ask 按钮偶发无响应**
   - 修复 Webview 消息监听在面板重开后失效的问题。

2. **工具点击/展示交互不一致**
   - 工具项从“执行入口”收敛为“说明 + `@tool` 显式调用”模式，避免误触发。

3. **OEM 登录仍要求手填凭据**
   - 修复为优先读取插件设置与 SecretStorage，登录自动注入。

4. **敏感信息泄露风险**
   - 对工具参数、工具返回与最终回答进行脱敏（用户名/密码/API 地址等）。

5. **多 `@tool` 顺序与依赖问题**
   - 修复工具顺序错乱：严格按用户输入顺序执行。
   - 修复 `oem_login` 后 `ask_ops` 认证失败：自动透传/复用 `session_id`。

6. **结果重复输出（text + structuredContent 重复）**
   - MCP 返回处理增加去重策略，避免最终结果重复渲染。

7. **ask_ops 误拦截提示（非预期）**
   - 收窄告警诊断强制规则，避免普通主机查询被误判。
   - 显式 `@ask_ops` 现在直接执行，避免出现“请显式使用 @ask_ops”的错误提示。

---

### 0.3 当前设计边界（与你的要求保持一致）

1. **插件端只实现通用编排与体验**
   - 连接 MCP、工具编排、结果展示、设置与密钥管理。

2. **工具依赖关系判定交由 MCP Server**
   - 插件仅保证：
     - 登录前置能力可用（`oem_login` + `session_id` 复用）
     - 多工具按顺序触发
   - 更复杂的“工具间依赖图/前置条件”由 MCP Server 后续扩展实现。

3. **MVP 优先“可演示可落地”**
   - 先完成闭环：可配置、可连接、可提问、可调用工具、可展示轨迹、可打包。
   - 后续再逐步增强高风险动作确认、卡片化展示、审批流与 RBAC。

目标：
- 单独配置你的 MCP Server
- 单独配置你的 LLM（优先支持 OpenAI-compatible，适合 DeepSeek）
- 用最小、清晰、可维护的结构做成可持续扩展的专用插件

## 1. 方案定位

这不是一个通用 IDE Agent，而是一个专门服务于你的告警场景的“轻量客户端”。

推荐边界：
- **插件负责**：连接 MCP、读取工具清单、把工具暴露给 LLM、渲染结果、保存配置与密钥
- **MCP Server 负责**：真正的告警查询、过滤、汇总、处置、确认、关闭等能力
- **LLM 负责**：意图理解、参数组织、调用哪个工具、如何总结结果

这样拆分以后，后面无论你换：
- MCP Server 实现
- LLM 厂商
- UI 交互方式
- 审批/确认流程

都不需要整体推翻。

---

## 2. MVP 功能范围

### 必做
1. 在 VS Code 设置中配置：
   - MCP Server URL
   - MCP 连接模式（auto / legacy-sse / streamable-http）
   - LLM Base URL
   - LLM Model
   - Temperature

2. 在 VS Code SecretStorage 中保存：
   - LLM API Key
   - MCP Bearer Token（可选）

3. 左侧 Sidebar 显示：
   - MCP 连接状态
   - 当前模型
   - 当前工具数量
   - 可用工具列表（前若干项）

4. 打开一个 Webview Console：
   - 输入问题
   - 调用 LLM
   - 自动决定是否调用 MCP tool
   - 返回最终答案
   - 展示执行轨迹

### 第二阶段再做
- 用户确认后才能执行高风险操作
- 对不同 tool 做参数表单化输入
- 多轮会话持久化
- 审批流 / RBAC
- deepseek-reasoner 专项适配
- 告警对象卡片化、表格化、趋势图

---

## 3. 推荐目录结构

```text
src/
  extension.ts                    # 入口
  commands/
    commandHelpers.ts             # 配置密钥等命令
  services/
    settingsService.ts            # 读取 settings.json
    secretStorageService.ts       # 安全保存 API key / token
    mcp/
      mcpClientService.ts         # MCP 连接、listTools、callTool
    llm/
      openAiCompatibleLlmService.ts
  orchestration/
    assistantOrchestrator.ts      # LLM + Tool Loop 核心编排
  views/
    opsSidebarProvider.ts         # 左侧树
    chatPanel.ts                  # 主 Webview
  types/
    appTypes.ts
```

---

## 4. 交互流程

```text
用户输入问题
   ↓
AssistantOrchestrator 读取 MCP tools
   ↓
将 MCP tools 转成 OpenAI-compatible tools schema
   ↓
调用 LLM
   ↓
如果 LLM 返回 tool_calls
   ↓
调用 MCP tool
   ↓
把 tool result 再喂回 LLM
   ↓
得到最终回答
   ↓
Webview 展示“最终答案 + 执行轨迹”
```

---

## 5. 为什么这个方案适合你

### 简单
- 不依赖复杂的 IDE Agent 框架
- 不绑定 Cline 内部机制
- 只做你真正需要的功能

### 容易落地
- UI 用 VS Code 原生 Sidebar + Webview
- 配置走 `contributes.configuration`
- 密钥走 `SecretStorage`
- MCP 层独立，LLM 层独立

### 方便维护和扩展
- 后面要换 DeepSeek、OpenAI、内部代理，只改 `llm/`
- 后面要把 SSE 升级为 Streamable HTTP，只改 `mcp/`
- 后面要加审批、审计、会话历史，只加新服务层

---

## 6. 开发步骤

### 6.1 安装依赖

```bash
npm install
```

### 6.2 本地调试

```bash
npm run build
```

然后在 VS Code 中按 `F5` 启动 Extension Development Host。

### 6.3 初始化配置

在扩展宿主里执行命令：
- `OEM Assistant: Set LLM API Key`
- `OEM Assistant: Set MCP Bearer Token`（如果需要）
- `OEM Assistant: Connect MCP Server`
- `OEM Assistant: Open Console`

### 6.4 建议的初始 settings.json

```json
{
  "alertMcp.mcp.serverUrl": "http://127.0.0.1:3000/sse",
  "alertMcp.mcp.connectionMode": "auto",
  "alertMcp.llm.provider": "openai-compatible",
  "alertMcp.llm.baseUrl": "https://api.deepseek.com",
  "alertMcp.llm.model": "deepseek-chat",
  "alertMcp.llm.temperature": 0.1
}
```

---

## 7. 与你当前场景最相关的建议

1. **MVP 先默认 `deepseek-chat`**
   - 因为面向 tool-calling 的接入最直接，工程复杂度最低。

2. **现有 SSE MCP Server 先兼容，不急着重写服务端**
   - 客户端已经预留 `auto` 模式：优先尝试 Streamable HTTP，再 fallback 到 legacy SSE。

3. **高风险 tool 不要直接开放给模型裸调**
   - 建议在后续版本加：
     - destructive 标识
     - 二次确认
     - 操作审计日志
     - 只读 / 可执行分层

4. **不要把所有业务逻辑塞进 prompt**
   - 过滤规则、字段映射、默认时间范围、告警级别映射，尽量沉到 MCP Server 或插件配置层。

---

## 8. 下一步最值得做的增强

### A. 增加“操作确认门”
例如：
- 查询类：直接执行
- 处置类：必须弹出确认框
- 关闭类：必须输入 reason

### B. 增加“场景模板”
例如在侧栏提供：
- 最近 2 小时 P1 告警
- 按对象分组统计
- 查询某个主机当前告警
- 查询并给出处置建议

### C. 增加“输出结构化卡片”
对典型 tool 的 `structuredContent` 做专门渲染，而不是纯文本。

### D. 增加“组织级配置”
把公共配置抽到 workspace settings，让团队共用 server URL、默认模型、默认策略。

---

## 9. 已知注意点

1. 这个骨架优先解决“架构正确、边界清晰、容易起步”的问题。
2. `@modelcontextprotocol/client`、VS Code API、以及 MCP 新版 transport 还在持续演进，首次落地时请按当前官方文档微调依赖版本。
3. `deepseek-reasoner` 的 Thinking + Tool Calls 能力更强，但接入时需要处理额外的 reasoning continuation 逻辑，建议放到第二阶段。
