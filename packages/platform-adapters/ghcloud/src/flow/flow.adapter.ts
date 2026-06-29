import { type FlowInvokeRequest, type FlowInvokeSyncResponse, type FlowInvokerPort } from "@cube-ai/contracts";

import { GhcloudPlatformError } from "../errors";
import { doFetchJson } from "../fetch-utils";
import { buildRunStreamRequestBody, consumeFlowRunStreamResponse, remotePayloadToSyncResponse } from "./flow-run-stream";

export interface GhcloudFlowInvokerAdapterOpts {
  baseUrl: string;
  tokenProvider: (tenant: number) => Promise<string>;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export class GhcloudFlowInvokerAdapter implements FlowInvokerPort {
  constructor(private readonly opts: GhcloudFlowInvokerAdapterOpts) {}

  async invoke(req: FlowInvokeRequest, signal: AbortSignal): Promise<FlowInvokeSyncResponse> {
    const token = req.userToken ?? (await this.opts.tokenProvider(req.tenant));
    const headers: Record<string, string> = {
      Accept: "text/event-stream, application/json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-Engine-Caller": "cube-agentic-engine",
      "X-Trace-Id": req.traceId,
      tenant: String(req.tenant),
      terminal: "bimops-manage-web",
    };

    const runStreamUrl = `${this.opts.baseUrl}/ai/flows/${encodeURIComponent(req.flowId)}/run-stream`;
    const runUrl = `${this.opts.baseUrl}/ai/flows/${encodeURIComponent(req.flowId)}/run`;
    const bodyJson = buildRunStreamRequestBody(req.variables);
    const timeoutMs = this.opts.timeoutMs ?? 30_000;
    const fetchImpl = this.opts.fetchImpl ?? globalThis.fetch;

    try {
      return await this.invokeRunStream({
        bodyJson,
        fetchImpl,
        headers,
        signal,
        timeoutMs,
        url: runStreamUrl,
      });
    } catch (e) {
      if (!this.shouldFallbackToRun(e)) {
        throw e;
      }
    }

    const { body } = await this.fetchWithCallerAbort({
      bodyJson,
      fetchImpl,
      headers,
      method: "POST",
      signal,
      timeoutMs,
      url: runUrl,
    });

    return remotePayloadToSyncResponse(body);
  }

  private shouldFallbackToRun(error: unknown): boolean {
    if (!(error instanceof GhcloudPlatformError)) {
      return false;
    }
    if (error.code === "RESOURCE_NOT_FOUND_REMOTE") {
      return true;
    }
    const status = (error.details as { status?: number } | null)?.status;
    return status === 404 || status === 405;
  }

  private async invokeRunStream(opts: {
    url: string;
    headers: Record<string, string>;
    bodyJson: Record<string, unknown>;
    signal: AbortSignal;
    timeoutMs: number;
    fetchImpl: typeof fetch;
  }): Promise<FlowInvokeSyncResponse> {
    if (opts.signal.aborted) {
      throw GhcloudPlatformError.fromCode("UPSTREAM_NETWORK_TIMEOUT", `POST ${opts.url} aborted by caller`);
    }

    let abortListener: (() => void) | undefined;
    const ctrl = new AbortController();
    const onAbort = () => ctrl.abort();
    opts.signal.addEventListener("abort", onAbort);
    abortListener = onAbort;
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs);

    try {
      const fetchPromise = opts.fetchImpl(opts.url, {
        body: JSON.stringify(opts.bodyJson),
        headers: opts.headers,
        method: "POST",
        signal: ctrl.signal,
      });

      const abortPromise = new Promise<never>((_resolve, reject) => {
        if (opts.signal.aborted) {
          reject(GhcloudPlatformError.fromCode("UPSTREAM_NETWORK_TIMEOUT", `POST ${opts.url} aborted by caller`));
          return;
        }
        const onCallerAbort = () => {
          reject(GhcloudPlatformError.fromCode("UPSTREAM_NETWORK_TIMEOUT", `POST ${opts.url} aborted by caller`));
        };
        opts.signal.addEventListener("abort", onCallerAbort, { once: true });
      });

      const resp = await Promise.race([fetchPromise, abortPromise]);

      if (resp.status === 404 || resp.status === 405) {
        throw GhcloudPlatformError.fromCode("RESOURCE_NOT_FOUND_REMOTE", `POST ${opts.url} -> HTTP ${resp.status}`, {
          status: resp.status,
        });
      }
      if (resp.status === 401 || resp.status === 403) {
        throw GhcloudPlatformError.fromCode("UPSTREAM_AUTH_FAILED", `POST ${opts.url} -> HTTP ${resp.status}`, { status: resp.status });
      }
      if (!resp.ok) {
        throw GhcloudPlatformError.fromCode("UPSTREAM_TOOL_HTTP_FAILED", `POST ${opts.url} -> HTTP ${resp.status}`, {
          status: resp.status,
        });
      }

      return await consumeFlowRunStreamResponse(resp, opts.signal);
    } catch (e) {
      if (e instanceof GhcloudPlatformError) {
        throw e;
      }
      if (e instanceof Error && (e.name === "AbortError" || /abort/iu.test(e.message))) {
        throw GhcloudPlatformError.fromCode("UPSTREAM_NETWORK_TIMEOUT", `POST ${opts.url} timed out after ${opts.timeoutMs}ms`);
      }
      const msg = e instanceof Error ? e.message : String(e);
      throw GhcloudPlatformError.fromCode("UPSTREAM_TOOL_HTTP_FAILED", `POST ${opts.url} failed: ${msg}`);
    } finally {
      clearTimeout(timer);
      if (abortListener) {
        opts.signal.removeEventListener("abort", abortListener);
      }
    }
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
