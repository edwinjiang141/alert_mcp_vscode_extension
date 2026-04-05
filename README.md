# Alert MCP Assistant for VS Code

一个面向“告警查询与处理”场景的专用 VS Code 插件骨架。

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
- `Alert MCP: Set LLM API Key`
- `Alert MCP: Set MCP Bearer Token`（如果需要）
- `Alert MCP: Connect MCP Server`
- `Alert MCP: Open Console`

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

