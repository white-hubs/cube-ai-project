/**
 * SSE 响应头与 @dangao/bun-server 示例一致（见 bun-server
 * `examples/01-core-features/sse-heartbeat-issue53-app.ts` 中 `sseResponse`）。
 *
 * 框架在 `Application` 开启 `sseKeepAlive` 后，会对 `Content-Type: text/event-stream`
 * 的响应做 `wrapSseWithHeartbeat`；业务层只需返回标准 SSE `Response`，勿在业务里再包一层心跳。
 *
 * 内层 `ReadableStream` 请使用 `async start` + `await` 再 `close` 的模式，避免同一次
 * `pull` 内 `enqueue` + `close` 与 Bun 心跳包装叠加丢尾包（Issue #53 类问题）。
 */
export function createSseResponse(
  stream: ReadableStream<Uint8Array>,
  init?: { status?: number; headers?: Record<string, string> },
): Response {
  const headers = new Headers({
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "Content-Type": "text/event-stream; charset=utf-8",
    /** 反向代理（如 nginx）下减少缓冲，便于流式到达客户端 */
    "X-Accel-Buffering": "no",
  });
  if (init?.headers) {
    for (const [k, v] of Object.entries(init.headers)) {
      if (v) {
        headers.set(k, v);
      }
    }
  }
  return new Response(stream, {
    headers,
    status: init?.status ?? 200,
  });
}
