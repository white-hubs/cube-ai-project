/**
 * 内置 handler 类型（闭集）。
 * 对齐 docs/detailed-design/07-tools/builtin-catalog.md §0 速查表。
 */
export const HANDLER_KINDS = [
  'http',
  'shell',
  'sql',
  'vector',
  'memory',
  'openapi',
  'mcp',
  'llm',
  'flow',
  'flowList',
  'knowledge',
  'clock',
  /** DashScope Qwen 图像生成/编辑 + 引擎本机落盘 URL */
  'qwenImage',
] as const;

export type HandlerKindValue = (typeof HANDLER_KINDS)[number];

export function isHandlerKind(value: string): value is HandlerKindValue {
  return (HANDLER_KINDS as readonly string[]).includes(value);
}
