/**
 * McpBridgeService — MCP stdio JSON-RPC：连接池（每 server 一子进程）、tools/call、故障重启。
 *
 * 权威来源：docs/detailed-design/07-tools/registration-lifecycle.md §7
 */
import { Injectable } from '@dangao/bun-server';
import { AgenticEngineError } from '../../infra/errors/agentic-error';
import {
  ToolDescriptor as ToolDescriptorZod,
  type ToolDescriptor,
} from '@cube-ai/contracts';
import { augmentWebSearchMcpToolDescriptor } from './web-search-mcp-descriptor';

/** MCP server 配置（对齐 Cursor CLI mcpServers）— registration-lifecycle.md §7.1 */
export interface McpServerConfig {
  type:     'stdio' | 'sse' | 'http';
  command?: string;
  args?:    string[];
  url?:     string;
  env?:     Record<string, string>;
  headers?: Record<string, string>;
  name?:    string;
  enabled:  boolean;
}

export interface McpServersConfig {
  mcpServers: Record<string, McpServerConfig>;
}

/** 只读公开检索类 MCP（如 config 里的 `web-search`）— 本引擎不要求用户 consent。 */
const MCP_SERVER_IDS_CONSENT_NEVER = new Set<string>(['web-search']);

function defaultConsentForMcpServer(serverName: string): 'NEVER' | 'ON_FIRST_USE' {
  return MCP_SERVER_IDS_CONSENT_NEVER.has(serverName) ? 'NEVER' : 'ON_FIRST_USE';
}

/** MCP SSE GET connect timeout (ms); avoids indefinite bootstrap hang when server is down. */
function mcpConnectTimeoutMs(): number {
  const raw = process.env['AGENTIC_ENGINE_MCP_CONNECT_TIMEOUT_MS'];
  if (raw === undefined || raw.trim() === '') return 10_000;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 10_000;
}

interface JsonRpcReq {
  jsonrpc: '2.0';
  id?:     number | string;
  method:  string;
  params?: unknown;
}

interface JsonRpcResp {
  jsonrpc: '2.0';
  id?:      number | string | null;
  result?: unknown;
  error?:   { code: number; message: string; data?: unknown };
}

interface McpSession {
  isAlive(): boolean;
  start(): Promise<void>;
  toolsList(): Promise<Array<{ name: string; description?: string; inputSchema?: unknown }>>;
  toolsCall(name: string, args: Record<string, unknown>): Promise<unknown>;
  dispose(): Promise<void>;
}

interface SseStreamReader {
  read(): Promise<{ done: boolean; value?: Uint8Array }>;
  cancel(): Promise<unknown>;
}

function stdoutReader(proc: ReturnType<typeof Bun.spawn>) {
  const s = proc.stdout;
  if (!s || typeof s === 'number') return null;
  return s.getReader();
}

async function writeStdin(proc: ReturnType<typeof Bun.spawn>, chunk: Uint8Array): Promise<void> {
  const sink = proc.stdin;
  if (!sink || typeof sink === 'number') throw new Error('MCP stdin unavailable');
  await Promise.resolve(sink.write(chunk));
}

/**
 * STDIO MCP 会话：单行 JSON-RPC（JSON-RPC 2.0）。
 */
class McpStdioSession implements McpSession {
  private pending = new Map<number | string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private nextId = 1;
  private buf = '';
  private proc: ReturnType<typeof Bun.spawn> | null = null;
  private readerStopped = false;

  constructor(
    private readonly serverName: string,
    private readonly cfg: McpServerConfig,
  ) {}

  isAlive(): boolean {
    try {
      return this.proc !== null && this.proc.exitCode === null;
    } catch {
      return false;
    }
  }

  async start(): Promise<void> {
    if (this.cfg.type !== 'stdio') {
      throw AgenticEngineError.fromCode(
        'UNIMPLEMENTED_MCP_ADAPTER',
        `McpBridge: transport '${this.cfg.type}' not implemented (stdio only in P3-10)`,
      );
    }
    if (!this.cfg.command) {
      throw AgenticEngineError.fromCode(
        'INVALID_ARGUMENT_SCHEMA_VIOLATION',
        'McpBridge: stdio server requires command',
      );
    }

    this.proc = Bun.spawn([this.cfg.command, ...(this.cfg.args ?? [])], {
      env:    { ...process.env, ...this.cfg.env },
      stdin:  'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
    });

    this.readerStopped = false;
    void this.readStdout();

    await this.rpc('initialize', {
      protocolVersion: '2024-11-05',
      capabilities:    {},
      clientInfo:       { name: 'cube-agentic-engine', version: '0.0.0' },
    });
    await this.notify('notifications/initialized', {});
  }

  private async readStdout(): Promise<void> {
    const reader = this.proc ? stdoutReader(this.proc) : null;
    if (!reader) return;
    const dec = new TextDecoder();
    try {
      while (!this.readerStopped) {
        const { done, value } = await reader.read();
        if (done) break;
        this.buf += dec.decode(value, { stream: true });
        const lines = this.buf.split('\n');
        this.buf = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          let msg: JsonRpcResp;
          try {
            msg = JSON.parse(line) as JsonRpcResp;
          } catch {
            continue;
          }
          if (msg.id !== undefined && msg.id !== null && this.pending.has(msg.id)) {
            const p = this.pending.get(msg.id)!;
            this.pending.delete(msg.id);
            if (msg.error) {
              p.reject(new Error(msg.error.message));
            } else {
              p.resolve(msg.result);
            }
          }
        }
      }
    } catch {
      /* ignore reader teardown */
    }
  }

  private async notify(method: string, params?: unknown): Promise<void> {
    if (!this.proc) throw new Error('MCP stdin unavailable');
    const payload: JsonRpcReq = { jsonrpc: '2.0', method, params };
    const line = `${JSON.stringify(payload)}\n`;
    await writeStdin(this.proc, new TextEncoder().encode(line));
  }

  async rpc(method: string, params?: unknown): Promise<unknown> {
    if (!this.proc) throw new Error('MCP stdin unavailable');
    const id = this.nextId++;
    const payload: JsonRpcReq = { jsonrpc: '2.0', id, method, params };
    const line = `${JSON.stringify(payload)}\n`;

    const p = new Promise<unknown>((resolve, reject) => {
      const t = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`MCP RPC timeout: ${method}`));
        }
      }, 120_000);
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(t);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(t);
          reject(e);
        },
      });
    });

    await writeStdin(this.proc, new TextEncoder().encode(line));

    return p;
  }

  async toolsList(): Promise<Array<{ name: string; description?: string; inputSchema?: unknown }>> {
    const result = (await this.rpc('tools/list', {})) as {
      tools?: Array<{ name: string; description?: string; inputSchema?: unknown }>;
    };
    return result.tools ?? [];
  }

  async toolsCall(name: string, args: Record<string, unknown>): Promise<unknown> {
    const result = await this.rpc('tools/call', {
      name,
      arguments: args,
    });
    return result;
  }

  async dispose(): Promise<void> {
    this.readerStopped = true;
    try {
      if (this.proc && typeof this.proc !== 'number') {
        this.proc.kill();
      }
    } catch {
      /* ignore */
    }
    this.proc = null;
    this.pending.clear();
  }
}

/**
 * SSE MCP 会话：GET text/event-stream 接收 JSON-RPC 响应，POST endpoint 发送请求。
 *
 * 协议兼容 MCP legacy SSE transport：服务端先在 SSE 流里下发 `endpoint`
 * event，客户端之后把 JSON-RPC request POST 到该 endpoint，response 仍从 SSE
 * `message` event 回来。
 */
class McpSseSession implements McpSession {
  private pending = new Map<number | string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private endpointWaiters: Array<{ resolve: () => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }> = [];
  private nextId = 1;
  private buf = '';
  private reader: SseStreamReader | null = null;
  private abort = new AbortController();
  private endpointUrl: string | null = null;
  private readerStopped = false;
  private connected = false;

  constructor(
    private readonly serverName: string,
    private readonly cfg: McpServerConfig,
  ) {}

  isAlive(): boolean {
    return this.connected && !this.abort.signal.aborted && !this.readerStopped;
  }

  async start(): Promise<void> {
    if (this.cfg.type !== 'sse') {
      throw AgenticEngineError.fromCode(
        'UNIMPLEMENTED_MCP_ADAPTER',
        `McpBridge: transport '${this.cfg.type}' not implemented by SSE session`,
      );
    }
    if (!this.cfg.url) {
      throw AgenticEngineError.fromCode(
        'INVALID_ARGUMENT_SCHEMA_VIOLATION',
        'McpBridge: sse server requires url',
      );
    }

    this.abort = new AbortController();
    const connectTimeout = setTimeout(
      () => this.abort.abort('mcp-sse-connect-timeout'),
      mcpConnectTimeoutMs(),
    );
    let resp: Response;
    try {
      resp = await fetch(this.cfg.url, {
        method: 'GET',
        headers: {
          Accept: 'text/event-stream',
          ...(this.cfg.headers ?? {}),
        },
        signal: this.abort.signal,
      });
    } finally {
      clearTimeout(connectTimeout);
    }
    if (!resp.ok || !resp.body) {
      throw new Error(`MCP SSE connect failed: HTTP ${resp.status}`);
    }

    this.reader = resp.body.getReader() as SseStreamReader;
    this.connected = true;
    this.readerStopped = false;
    void this.readSse();

    await this.waitForEndpoint(10_000);
    await this.rpc('initialize', {
      protocolVersion: '2024-11-05',
      capabilities:    {},
      clientInfo:       { name: 'cube-agentic-engine', version: '0.0.0' },
    });
    await this.notify('notifications/initialized', {});
  }

  private waitForEndpoint(timeoutMs: number): Promise<void> {
    if (this.endpointUrl) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`MCP SSE endpoint timeout: ${this.serverName}`));
      }, timeoutMs);
      this.endpointWaiters.push({
        resolve: () => {
          clearTimeout(timer);
          resolve();
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
        timer,
      });
    });
  }

  private setEndpoint(raw: string): void {
    if (!this.cfg.url) return;
    this.endpointUrl = new URL(raw, this.cfg.url).toString();
    const waiters = this.endpointWaiters.splice(0);
    for (const w of waiters) w.resolve();
  }

  private failAllPending(error: Error): void {
    for (const [, p] of this.pending) p.reject(error);
    this.pending.clear();
    const waiters = this.endpointWaiters.splice(0);
    for (const w of waiters) {
      clearTimeout(w.timer);
      w.reject(error);
    }
  }

  private async readSse(): Promise<void> {
    const reader = this.reader;
    if (!reader) return;
    const dec = new TextDecoder();
    try {
      while (!this.readerStopped) {
        const { done, value } = await reader.read();
        if (done) break;
        this.buf += dec.decode(value, { stream: true });
        this.drainSseBuffer();
      }
    } catch (e) {
      if (!this.readerStopped) {
        this.failAllPending(e instanceof Error ? e : new Error(String(e)));
      }
    } finally {
      this.connected = false;
    }
  }

  private drainSseBuffer(): void {
    this.buf = this.buf.replace(/\r\n/g, '\n');
    while (true) {
      const idx = this.buf.indexOf('\n\n');
      if (idx === -1) return;
      const block = this.buf.slice(0, idx);
      this.buf = this.buf.slice(idx + 2);
      this.handleSseBlock(block);
    }
  }

  private handleSseBlock(block: string): void {
    let event = 'message';
    const dataLines: string[] = [];
    for (const line of block.split('\n')) {
      if (!line || line.startsWith(':')) continue;
      const sep = line.indexOf(':');
      const field = sep === -1 ? line : line.slice(0, sep);
      let value = sep === -1 ? '' : line.slice(sep + 1);
      if (value.startsWith(' ')) value = value.slice(1);
      if (field === 'event') event = value;
      if (field === 'data') dataLines.push(value);
    }
    const data = dataLines.join('\n');
    if (!data) return;

    if (event === 'endpoint') {
      this.setEndpoint(data);
      return;
    }

    try {
      const msg = JSON.parse(data) as JsonRpcResp;
      this.handleJsonRpcMessage(msg);
    } catch {
      /* ignore malformed SSE payloads */
    }
  }

  private handleJsonRpcMessage(msg: JsonRpcResp): void {
    if (msg.id === undefined || msg.id === null) return;
    const p = this.pending.get(msg.id);
    if (!p) return;
    this.pending.delete(msg.id);
    if (msg.error) {
      p.reject(new Error(msg.error.message));
    } else {
      p.resolve(msg.result);
    }
  }

  private async notify(method: string, params?: unknown): Promise<void> {
    await this.postJsonRpc({ jsonrpc: '2.0', method, params });
  }

  async rpc(method: string, params?: unknown): Promise<unknown> {
    const id = this.nextId++;
    const payload: JsonRpcReq = { jsonrpc: '2.0', id, method, params };
    const p = new Promise<unknown>((resolve, reject) => {
      const t = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`MCP RPC timeout: ${method}`));
        }
      }, 120_000);
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(t);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(t);
          reject(e);
        },
      });
    });

    try {
      await this.postJsonRpc(payload);
    } catch (e) {
      this.pending.delete(id);
      throw e;
    }

    return p;
  }

  private async postJsonRpc(payload: JsonRpcReq): Promise<void> {
    if (!this.endpointUrl) {
      throw new Error(`MCP SSE endpoint unavailable: ${this.serverName}`);
    }
    const resp = await fetch(this.endpointUrl, {
      method: 'POST',
      headers: {
        ...(this.cfg.headers ?? {}),
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify(payload),
      signal: this.abort.signal,
    });
    if (!resp.ok) {
      throw new Error(`MCP SSE POST failed: HTTP ${resp.status}`);
    }
    const text = await resp.text().catch(() => '');
    const trimmed = text.trim();
    if (trimmed.startsWith('{')) {
      try {
        this.handleJsonRpcMessage(JSON.parse(trimmed) as JsonRpcResp);
      } catch {
        /* ignore malformed direct response */
      }
    }
  }

  async toolsList(): Promise<Array<{ name: string; description?: string; inputSchema?: unknown }>> {
    const result = (await this.rpc('tools/list', {})) as {
      tools?: Array<{ name: string; description?: string; inputSchema?: unknown }>;
    };
    return result.tools ?? [];
  }

  async toolsCall(name: string, args: Record<string, unknown>): Promise<unknown> {
    return this.rpc('tools/call', {
      name,
      arguments: args,
    });
  }

  async dispose(): Promise<void> {
    this.readerStopped = true;
    try {
      this.abort.abort('mcp-sse-dispose');
    } catch {
      /* ignore */
    }
    try {
      await this.reader?.cancel();
    } catch {
      /* ignore */
    }
    this.connected = false;
    this.reader = null;
    this.pending.clear();
    this.endpointUrl = null;
  }
}

@Injectable()
export class McpBridgeService {
  private config: McpServersConfig | null = null;
  private sessions = new Map<string, McpSession>();

  /**
   * 初始化（读取 env 配置文件路径或 JSON 字面量）。
   */
  async init(config?: McpServersConfig): Promise<void> {
    if (config) {
      this.config = config;
      return;
    }
    if (this.config) return;
    const raw = process.env['AGENTIC_ENGINE_MCP_SERVERS_CONFIG'];
    if (!raw?.trim()) {
      this.config = null;
      return;
    }
    try {
      if (raw.trim().startsWith('{')) {
        this.config = JSON.parse(raw) as McpServersConfig;
        return;
      }
      const text = await Bun.file(raw.trim()).text();
      this.config = JSON.parse(text) as McpServersConfig;
    } catch {
      this.config = null;
    }
  }

  private cfgOrThrow(serverName: string): McpServerConfig {
    const c = this.config?.mcpServers[serverName];
    if (!c) {
      throw AgenticEngineError.fromCode(
        'RESOURCE_NOT_FOUND_DESCRIPTOR',
        `MCP server not configured: ${serverName}`,
      );
    }
    if (!c.enabled) {
      throw AgenticEngineError.fromCode(
        'PERMISSION_DENIED_GRANT_MISSING',
        `MCP server disabled: ${serverName}`,
      );
    }
    return c;
  }

  private async sessionFor(serverName: string): Promise<McpSession> {
    let s = this.sessions.get(serverName);
    if (s?.isAlive()) return s;

    if (s) {
      await s.dispose();
      this.sessions.delete(serverName);
    }

    const cfg = this.cfgOrThrow(serverName);
    let lastErr: unknown;
    for (let attempt = 1; attempt <= 3; attempt++) {
      s = this.createSession(serverName, cfg);
      try {
        await s.start();
        this.sessions.set(serverName, s);
        return s;
      } catch (e) {
        lastErr = e;
        await s.dispose();
      }
    }
    throw AgenticEngineError.fromCode(
      'UPSTREAM_MCP_CONNECTION_FAILED',
      `MCP bridge could not start server '${serverName}': ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
    );
  }

  private createSession(serverName: string, cfg: McpServerConfig): McpSession {
    if (cfg.type === 'stdio') return new McpStdioSession(serverName, cfg);
    if (cfg.type === 'sse') return new McpSseSession(serverName, cfg);
    throw AgenticEngineError.fromCode(
      'UNIMPLEMENTED_MCP_ADAPTER',
      `McpBridge: transport '${cfg.type}' not implemented`,
    );
  }

  /**
   * 列出已从 MCP servers 发现的工具（转换为 ToolDescriptor v1 最小集）。
   */
  async listTools(): Promise<ToolDescriptor[]> {
    await this.init();
    if (!this.config?.mcpServers) return [];

    const out: ToolDescriptor[] = [];
    for (const [serverName, srv] of Object.entries(this.config.mcpServers)) {
      if (!srv.enabled || (srv.type !== 'stdio' && srv.type !== 'sse')) continue;
      try {
        const sess = await this.sessionFor(serverName);
        const tools = await sess.toolsList();
        for (const t of tools) {
          const name = `mcp.${serverName}.${t.name}`;
          const rawInputSchema =
            typeof t.inputSchema === 'object' && t.inputSchema !== null
              ? (t.inputSchema as Record<string, unknown>)
              : { type: 'object', properties: {} };
          const guided = augmentWebSearchMcpToolDescriptor({
            serverName,
            mcpToolName: t.name,
            description: t.description ?? '',
            inputSchema: rawInputSchema,
          });
          const parsed = ToolDescriptorZod.safeParse({
            schemaVersion: 1,
            kind:          'TOOL',
            name,
            displayName:   t.name,
            description:   guided.description,
            isPreset:      false,
            version:       '1.0.0',
            meta: {
              execution:          'REMOTE',
              consent:            defaultConsentForMcpServer(serverName),
              requiresPrincipal:  'USER',
              timeoutMs:          120_000,
              idempotent:         false,
              sideEffects:        [],
            },
            inputSchema: guided.inputSchema,
            outputSchema: { type: 'object', properties: {} },
            requires:     { principal: 'USER', oauthScope: [], obo: null },
            execute:      `mcp:${serverName}:${t.name}`,
            handler:      { kind: 'mcp', config: {} },
            tags:         ['mcp', serverName],
            category:     'MCP',
          });
          if (parsed.success) out.push(parsed.data);
        }
      } catch {
        /* skip unreachable servers — integration tests cover live paths */
      }
    }
    return out;
  }

  /**
   * 调用 MCP tool（JSON-RPC tools/call）。
   */
  async callTool(
    serverName: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    await this.init();
    let attempt = 0;
    let lastErr: unknown;
    while (attempt < 2) {
      attempt++;
      try {
        const sess = await this.sessionFor(serverName);
        return await sess.toolsCall(toolName, args);
      } catch (e) {
        lastErr = e;
        const s = this.sessions.get(serverName);
        if (s) {
          await s.dispose();
          this.sessions.delete(serverName);
        }
      }
    }
    throw AgenticEngineError.fromCode(
      'UPSTREAM_MCP_TOOL_FAILED',
      `callTool failed for ${serverName}/${toolName}: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
    );
  }

  async dispose(): Promise<void> {
    const sessions = [...this.sessions.values()];
    this.sessions.clear();
    await Promise.all(sessions.map((s) => s.dispose().catch(() => {})));
  }
}
