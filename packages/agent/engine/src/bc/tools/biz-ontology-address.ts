/**
 * 问数连接地址和原文核对。不依赖 MCP 传输，避免和 bridge 循环引用。
 */
export const BIZ_ONTOLOGY_SERVER_ID = "biz-ontology";
export const ASK_BUSINESS_DATA_TOOL = "ask_business_data";

export class AskBusinessDataStepGate {
  private ids: string[] = [];
  private opened: Promise<number> | null = null;

  /** 同一同步突发里的调用共享一次计数。大于 1 则全部拒绝；下一步重新计数。 */
  enter(id: string): Promise<boolean> {
    this.ids.push(id);
    if (this.opened === null) {
      const batch = this.ids;
      this.opened = Promise.resolve().then(() => {
        const size = batch.length;
        this.ids = [];
        this.opened = null;
        return size;
      });
    }
    const opened = this.opened;
    return opened.then((size) => size === 1);
  }
}

export function bizOntologyUrlFromAddress(raw: { host?: unknown; port?: unknown; path?: unknown }): string | null {
  const host = String(raw.host ?? "").trim();
  const pathRaw = String(raw.path ?? "").trim();
  const port = typeof raw.port === "number" ? raw.port : Number(String(raw.port ?? "").trim());
  if (!host || host.includes("://") || host.includes("/")) return null;
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  if (!pathRaw.startsWith("/")) return null;
  const path = pathRaw.endsWith("/") ? pathRaw : `${pathRaw}/`;
  return `http://${host}:${port}${path}`;
}

/** 仅当 biz-ontology 写了 host/port/path 时改写。只有 url 的旧测试配置保持原样。 */
export function normalizeBizOntologyServerConfig(config: {
  host?: unknown;
  port?: unknown;
  path?: unknown;
  type?: "stdio" | "sse" | "http";
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  headers?: Record<string, string>;
  name?: string;
  consent?: "NEVER" | "ON_FIRST_USE";
  authPassthrough?: "none" | "user";
  required?: boolean;
  enabled: boolean;
  fixedBizOntologyTools?: boolean;
}):
  | {
      type: "http";
      url: string;
      name: string;
      consent: "NEVER";
      authPassthrough: "user";
      enabled: true;
      fixedBizOntologyTools: true;
    }
  | typeof config
  | null {
  if (config.host == null && config.port == null && config.path == null) return config;
  const url = bizOntologyUrlFromAddress(config);
  if (!url) return null;
  return {
    type: "http",
    url,
    name: BIZ_ONTOLOGY_SERVER_ID,
    consent: "NEVER",
    authPassthrough: "user",
    enabled: true,
    fixedBizOntologyTools: true,
  };
}

function compact(text: string): string {
  return text.normalize("NFKC").replace(/\s+/g, "");
}

function clauses(text: string): string[] {
  return text
    .split(/[，,。！？；;!?]+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function isWholeClauseDeletion(source: string, asked: string): boolean {
  const sourceClauses = clauses(source);
  const askedClauses = clauses(asked);
  if (askedClauses.length === 0 || askedClauses.length > sourceClauses.length) return false;
  let index = 0;
  for (const clause of askedClauses) {
    const key = compact(clause);
    let found = false;
    while (index < sourceClauses.length) {
      const current = sourceClauses[index];
      index += 1;
      if (compact(current) === key) {
        found = true;
        break;
      }
    }
    if (!found) return false;
  }
  return true;
}

/**
 * 模型只能整句删掉用户原话里用标点分开的片段，不能改写任何一句内部的字。
 * 不维护时间或分组词表。对不上就用用户原话。
 */
export function askQuestionFromModel(question: unknown, prompt: unknown): string | null {
  const asked = String(question ?? "").trim();
  const source = String(prompt ?? "").trim();
  if (!asked) return source || null;
  if (!source) return asked;
  if (isWholeClauseDeletion(source, asked)) return asked;
  return source;
}
