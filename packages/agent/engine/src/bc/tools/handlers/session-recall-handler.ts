/**
 * SessionRecallHandler — 常驻 session_recall 工具（ADR-0036）。
 * 读本 session MySQL transcript，经 assembleSessionRecall 做预算/过滤。
 */
import { Inject, Injectable } from "@dangao/bun-server";

import type { ToolHandlerCtx } from "../tool-context";
import type { ToolHandler } from "./base-handler";
import {
  assembleSessionRecall,
  SESSION_RECALL_DEFAULT_LIMIT,
  type SessionRecallInput,
  type SessionRecallOutput,
  type SessionTranscriptRow,
} from "./session-recall";

export const SESSION_TRANSCRIPT_READER_TOKEN = "agentic.tools.sessionTranscriptReader";

export interface SessionTranscriptReader {
  listBySession(params: { tenant: number; sessionId: string; limit: number }): Promise<SessionTranscriptRow[]>;
}

@Injectable()
export class SessionRecallHandler implements ToolHandler<SessionRecallInput, SessionRecallOutput> {
  readonly kind = "sessionRecall" as ToolHandler["kind"];

  constructor(
    @Inject(SESSION_TRANSCRIPT_READER_TOKEN)
    private readonly reader: SessionTranscriptReader,
  ) {}

  async invoke(input: SessionRecallInput, ctx: ToolHandlerCtx): Promise<SessionRecallOutput> {
    const raw = input && typeof input === "object" && !Array.isArray(input) ? input : {};
    const limit = Math.min(Math.max(raw.limit ?? SESSION_RECALL_DEFAULT_LIMIT, 1), 200);
    const rows = await this.reader.listBySession({
      tenant: ctx.auth.tenant,
      sessionId: ctx.session.id,
      limit,
    });
    return assembleSessionRecall(rows, {
      ...(typeof raw.query === "string" ? { query: raw.query } : {}),
      ...(typeof raw.maxChars === "number" ? { maxChars: raw.maxChars } : {}),
      limit,
    });
  }
}
