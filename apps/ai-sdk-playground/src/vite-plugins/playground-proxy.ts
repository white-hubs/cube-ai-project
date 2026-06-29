import http, { type IncomingMessage, type ServerResponse } from "node:http";
import https from "node:https";
import { URL } from "node:url";

/** Internal dev-server mount; not shown in UI. Browser uses user-configured sdkPathPrefix. */
export const PLAYGROUND_PROXY_MOUNT = "/proxy";

export interface ProxyTargetStore {
  target: string;
}

export interface SdkPathPrefixStore {
  prefix: string;
}

export interface ProxyRequestRecord {
  id: string;
  at: number;
  browserMethod: string;
  browserPath: string;
  upstreamMethod: string;
  upstreamUrl: string;
  statusCode?: number;
  error?: string;
  durationMs?: number;
}

let recordSeq = 0;

function nextRecordId(): string {
  recordSeq += 1;
  return String(recordSeq);
}

export class ProxyRequestLog {
  private readonly entries: ProxyRequestRecord[] = [];

  constructor(private readonly maxEntries = 100) {}

  start(entry: Omit<ProxyRequestRecord, "id" | "at" | "statusCode" | "error" | "durationMs">): string {
    const id = nextRecordId();
    this.entries.unshift({
      at: Date.now(),
      id,
      ...entry,
    });
    if (this.entries.length > this.maxEntries) {
      this.entries.length = this.maxEntries;
    }
    return id;
  }

  complete(id: string, patch: Pick<ProxyRequestRecord, "statusCode" | "error" | "durationMs">): void {
    const entry = this.entries.find((item) => item.id === id);
    if (!entry) {
      return;
    }
    if (patch.statusCode !== undefined) {
      entry.statusCode = patch.statusCode;
    }
    if (patch.error !== undefined) {
      entry.error = patch.error;
    }
    if (patch.durationMs !== undefined) {
      entry.durationMs = patch.durationMs;
    }
  }

  list(limit = 50): ProxyRequestRecord[] {
    return this.entries.slice(0, Math.max(1, limit));
  }

  clear(): void {
    this.entries.length = 0;
  }
}

export function readProxyTarget(store: ProxyTargetStore): string {
  return store.target.replace(/\/$/u, "");
}

export function writeProxyTarget(store: ProxyTargetStore, target: string): void {
  try {
    const u = new URL(target.trim());
    store.target = `${u.protocol}//${u.host}`;
  } catch {
    store.target = target.trim().replace(/\/$/u, "");
  }
}

export function readSdkPathPrefix(store: SdkPathPrefixStore): string {
  const raw = store.prefix.trim();
  if (!raw || raw === "/") {
    return "";
  }
  const withSlash = raw.startsWith("/") ? raw : `/${raw}`;
  return withSlash.replace(/\/$/u, "");
}

export function writeSdkPathPrefix(store: SdkPathPrefixStore, prefix: string): void {
  store.prefix = readSdkPathPrefix({ prefix });
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function parseLimit(raw: string | undefined, fallback: number): number {
  if (!raw) {
    return fallback;
  }
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 200) : fallback;
}

function matchesSdkPathPrefix(url: string, prefix: string): boolean {
  if (!prefix) {
    return false;
  }
  return url === prefix || url.startsWith(`${prefix}/`) || url.startsWith(`${prefix}?`);
}

function forwardRequest(
  req: IncomingMessage,
  res: ServerResponse,
  targetUrl: string,
  requestLog?: ProxyRequestLog,
  browserPath?: string,
): void {
  const parsed = new URL(targetUrl);
  const lib = parsed.protocol === "https:" ? https : http;
  const headers = { ...req.headers, host: parsed.host };
  const method = req.method ?? "GET";
  const started = Date.now();
  const recordId = requestLog?.start({
    browserMethod: method,
    browserPath: browserPath ?? req.url ?? "",
    upstreamMethod: method,
    upstreamUrl: targetUrl,
  });

  const proxyReq = lib.request(
    {
      headers,
      hostname: parsed.hostname,
      method,
      path: `${parsed.pathname}${parsed.search}`,
      port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
      protocol: parsed.protocol,
    },
    (proxyRes) => {
      if (recordId && requestLog) {
        requestLog.complete(recordId, {
          durationMs: Date.now() - started,
          statusCode: proxyRes.statusCode ?? 502,
        });
      }
      res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
      proxyRes.pipe(res);
    },
  );

  proxyReq.on("error", (err) => {
    if (recordId && requestLog) {
      requestLog.complete(recordId, {
        durationMs: Date.now() - started,
        error: err.message,
      });
    }
    if (!res.headersSent) {
      sendJson(res, 502, { error: err.message });
    } else {
      res.end();
    }
  });

  req.pipe(proxyReq);
}

export interface PlaygroundProxyOptions {
  store: ProxyTargetStore;
  pathPrefixStore: SdkPathPrefixStore;
  requestLog?: ProxyRequestLog;
}

export function createPlaygroundProxyMiddleware(
  options: PlaygroundProxyOptions,
): (req: IncomingMessage, res: ServerResponse, next: () => void) => void {
  const requestLog = options.requestLog;

  return (req, res, next) => {
    const url = req.url ?? "";

    if (url.startsWith("/__playground/proxy-log")) {
      const parsed = new URL(url, "http://playground.local");
      if (req.method === "GET" && parsed.pathname === "/__playground/proxy-log") {
        sendJson(res, 200, {
          items: requestLog?.list(parseLimit(parsed.searchParams.get("limit") ?? undefined, 50)) ?? [],
        });
        return;
      }
      if (req.method === "DELETE" && parsed.pathname === "/__playground/proxy-log") {
        requestLog?.clear();
        sendJson(res, 200, { ok: true });
        return;
      }
      sendJson(res, 405, { error: "method not allowed" });
      return;
    }

    if (url === "/__playground/proxy-target" || url.startsWith("/__playground/proxy-target?")) {
      if (req.method === "GET") {
        sendJson(res, 200, { target: readProxyTarget(options.store) });
        return;
      }
      if (req.method === "POST") {
        void readBody(req)
          .then((raw) => {
            const parsed = JSON.parse(raw) as { target?: string };
            if (!parsed.target || typeof parsed.target !== "string") {
              sendJson(res, 400, { error: "target is required" });
              return;
            }
            writeProxyTarget(options.store, parsed.target);
            sendJson(res, 200, { ok: true, target: readProxyTarget(options.store) });
          })
          .catch((err: Error) => {
            sendJson(res, 400, { error: err.message });
          });
        return;
      }
      sendJson(res, 405, { error: "method not allowed" });
      return;
    }

    if (url === "/__playground/path-prefix" || url.startsWith("/__playground/path-prefix?")) {
      if (req.method === "GET") {
        sendJson(res, 200, { prefix: readSdkPathPrefix(options.pathPrefixStore) });
        return;
      }
      if (req.method === "POST") {
        void readBody(req)
          .then((raw) => {
            const parsed = JSON.parse(raw) as { prefix?: string };
            if (parsed.prefix === undefined || typeof parsed.prefix !== "string") {
              sendJson(res, 400, { error: "prefix is required" });
              return;
            }
            writeSdkPathPrefix(options.pathPrefixStore, parsed.prefix);
            sendJson(res, 200, { ok: true, prefix: readSdkPathPrefix(options.pathPrefixStore) });
          })
          .catch((err: Error) => {
            sendJson(res, 400, { error: err.message });
          });
        return;
      }
      sendJson(res, 405, { error: "method not allowed" });
      return;
    }

    const sdkPrefix = readSdkPathPrefix(options.pathPrefixStore);
    if (!matchesSdkPathPrefix(url, sdkPrefix)) {
      next();
      return;
    }

    const targetBase = readProxyTarget(options.store);
    if (!targetBase) {
      sendJson(res, 503, { error: "proxy target is not configured" });
      return;
    }

    const upstreamPath = url.startsWith("/") ? url : `/${url}`;
    forwardRequest(req, res, `${targetBase}${upstreamPath}`, requestLog, url);
  };
}

export function playgroundProxyVitePlugin(options: { defaultTarget: string; defaultPathPrefix: string }) {
  const store: ProxyTargetStore = { target: options.defaultTarget };
  const pathPrefixStore: SdkPathPrefixStore = { prefix: options.defaultPathPrefix };
  const requestLog = new ProxyRequestLog();
  const middleware = createPlaygroundProxyMiddleware({
    pathPrefixStore,
    requestLog,
    store,
  });

  return {
    configureServer(server: { middlewares: { use: (fn: typeof middleware) => void } }) {
      server.middlewares.use(middleware);
    },
    name: "playground-proxy",
  };
}
