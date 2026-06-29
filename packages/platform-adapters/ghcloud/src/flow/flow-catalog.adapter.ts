import {
  FlowCatalogItemSchema,
  type FlowCatalogListRequest,
  type FlowCatalogListResponse,
  FlowCatalogListResponseSchema,
  type FlowCatalogPort,
} from "@cube-ai/contracts";

import { GhcloudPlatformError } from "../errors";
import { doFetchJson } from "../fetch-utils";

export interface GhcloudFlowCatalogAdapterOpts {
  baseUrl: string;
  tokenProvider: (tenant: number) => Promise<string>;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

function mapRemoteRow(raw: unknown): Record<string, unknown> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw GhcloudPlatformError.fromCode("INVALID_ARGUMENT_SCHEMA_VIOLATION", "flow list item must be a JSON object");
  }
  const o = raw as Record<string, unknown>;
  const id = o["id"];
  if (typeof id !== "string" && typeof id !== "number") {
    throw GhcloudPlatformError.fromCode("INVALID_ARGUMENT_SCHEMA_VIOLATION", "flow list item missing string/number id");
  }
  const name = o["name"];
  const descRaw = o["description"];
  const description = descRaw === undefined ? undefined : descRaw === null ? null : typeof descRaw === "string" ? descRaw : String(descRaw);
  const item: Record<string, unknown> = {
    flowId: String(id),
    name: typeof name === "string" ? name : String(name ?? ""),
  };
  if (description !== undefined) {
    item["description"] = description;
  }
  if (o["enabled"] !== undefined) {
    item["enabled"] = o["enabled"];
  }
  if (typeof o["compileStatus"] === "string") {
    item["compileStatus"] = o["compileStatus"];
  }
  return item;
}

function normalizeListBody(body: unknown): {
  rows: unknown[];
  pagination?: {
    total: number;
    pages: number;
    currentPage: number;
    pageSize: number;
  };
} {
  if (Array.isArray(body)) {
    return { rows: body };
  }
  if (body !== null && typeof body === "object" && !Array.isArray(body)) {
    const o = body as Record<string, unknown>;
    const records = o["records"];
    if (Array.isArray(records)) {
      return {
        pagination: {
          currentPage: Number(o["currentPage"] ?? 1),
          pageSize: Number(o["pageSize"] ?? records.length),
          pages: Number(o["pages"] ?? 0),
          total: Number(o["total"] ?? 0),
        },
        rows: records,
      };
    }
  }
  throw GhcloudPlatformError.fromCode(
    "INVALID_ARGUMENT_SCHEMA_VIOLATION",
    "flow list remote body must be an array or a paged object with records[]",
  );
}

export class GhcloudFlowCatalogAdapter implements FlowCatalogPort {
  constructor(private readonly opts: GhcloudFlowCatalogAdapterOpts) {}

  async list(req: FlowCatalogListRequest, signal: AbortSignal): Promise<FlowCatalogListResponse> {
    const token = req.userToken ?? (await this.opts.tokenProvider(req.tenant));
    const url = new URL(`${this.opts.baseUrl.replace(/\/$/u, "")}/ai/flows`);
    if (req.keyword !== null && req.keyword !== undefined && req.keyword.trim() !== "") {
      url.searchParams.set("keyword", req.keyword.trim());
    }
    if (req.pageNumber !== null && req.pageNumber !== undefined && req.pageSize !== null && req.pageSize !== undefined) {
      url.searchParams.set("pageNumber", String(req.pageNumber));
      url.searchParams.set("pageSize", String(req.pageSize));
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      "X-Engine-Caller": "cube-agentic-engine",
      "X-Trace-Id": req.traceId,
      tenant: String(req.tenant),
      terminal: "bimops-manage-web",
    };

    const { body } = await this.fetchWithCallerAbort({
      fetchImpl: this.opts.fetchImpl,
      headers,
      method: "GET",
      signal,
      timeoutMs: this.opts.timeoutMs ?? 30_000,
      url: url.toString(),
    });

    const { rows, pagination } = normalizeListBody(body);
    const flows = rows.map((row) => FlowCatalogItemSchema.parse(mapRemoteRow(row)));
    return FlowCatalogListResponseSchema.parse({
      flows,
      ...(pagination ? { pagination } : {}),
    });
  }

  private async fetchWithCallerAbort(opts: Parameters<typeof doFetchJson>[0]): Promise<Awaited<ReturnType<typeof doFetchJson>>> {
    if (opts.signal.aborted) {
      throw GhcloudPlatformError.fromCode("UPSTREAM_NETWORK_TIMEOUT", `${opts.method} ${opts.url} aborted by caller`);
    }

    let abortListener: (() => void) | undefined;
    const abortPromise = new Promise<never>((_resolve, reject) => {
      abortListener = () => {
        reject(GhcloudPlatformError.fromCode("UPSTREAM_NETWORK_TIMEOUT", `${opts.method} ${opts.url} aborted by caller`));
      };
      opts.signal.addEventListener("abort", abortListener, { once: true });
    });

    try {
      return await Promise.race([doFetchJson(opts), abortPromise]);
    } finally {
      if (abortListener) {
        opts.signal.removeEventListener("abort", abortListener);
      }
    }
  }
}
