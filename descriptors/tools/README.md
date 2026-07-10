# Tool descriptors（本目录）

本目录**不再存放** ToolDescriptor YAML。

历史上这里有 `platform.flow.*` / `platform.knowledge.query` / `platform.descriptor.*` 等影子文件，
但运行时真相源已迁到代码：

| 工具 | 注册来源 | 当前状态 |
|------|----------|----------|
| `currentDate` | `engine-builtin-descriptors.ts` → `ensureBuiltinCurrentDateDescriptor` | **已注册** |
| `image.qwen` | `engine-builtin-descriptors.ts` → `ensureBuiltinImageQwenDescriptor` | **已注册** |
| `platform.knowledge.query` | `engine-builtin-descriptors.ts` → `ensureBuiltinPlatformToolDescriptors` | **已注册** |
| `platform.flow.list` | 同上（builder 仍保留） | **已禁用，不注册** |
| `platform.flow.invoke` | 同上（builder 仍保留） | **已禁用，不注册** |
| `platform.descriptor.{list,get,create,update,publish,delete,propose}` | `descriptor-ops.ts` → bootstrap `registerManagementToolDescriptors` | **已注册** |

## 现状说明

1. **不要在本目录加 YAML 期望覆盖内置工具。**  
   `ENGINE_BUILTIN_TOOL_NAMES` 内的名称会被 loader 丢弃，再由 `ensureBuiltin*` 按禁用名单决定是否补登。
2. **`platform.flow.*` 暂时关闭：**  
   仍在 `DISABLED_ENGINE_BUILTIN_TOOL_NAMES` / reserved 名单中（外部同名 descriptor 仍会被忽略），但 `ensureBuiltin*` 不会注册。重新启用：从该集合移除对应 name。
3. **自定义 / MCP 工具** 请走 Nacos 下发或把 `AGENTIC_ENGINE_TOOL_DESCRIPTOR_DIR` 指到**只含自定义工具文件**的目录（loader 非递归，只扫顶层 `.yaml/.yml/.json`）。
4. Agent 侧可见工具仍由各 agent 的 `availableTools` / `toolRefs` 白名单控制；默认 agent 已去掉 `platform.flow.*`。
