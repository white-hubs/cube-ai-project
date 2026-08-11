import { BadRequestException, Inject, Injectable, UnauthorizedException } from "@dangao/bun-server";

import {
  KnowledgeFeedbackSubmitRequestSchema,
  type KnowledgeFeedbackAuthContext,
  type KnowledgeFeedbackRecord,
  type KnowledgeFeedbackSubmitRequest,
} from "@cube-ai/contracts/platform";

import { APP_CONFIG_TOKEN, type AppConfig } from "../../../config/app.config";
import { assertFeedbackAuthorized, FeedbackUnauthorizedError } from "./search-feedback-auth";
import { SearchFeedbackMetricsQuery } from "./search-feedback-metrics";
import { SEARCH_FEEDBACK_REPOSITORY_TOKEN } from "./search-feedback.tokens";
import type { SearchFeedbackRepository, SearchFeedbackRow } from "./search-feedback.types";

@Injectable()
export class SearchFeedbackService {
  public constructor(
    @Inject(APP_CONFIG_TOKEN) private readonly config: AppConfig,
    @Inject(SEARCH_FEEDBACK_REPOSITORY_TOKEN) private readonly repository: SearchFeedbackRepository,
    private readonly metricsQuery: SearchFeedbackMetricsQuery,
  ) {}

  public async submit(raw: unknown, auth: KnowledgeFeedbackAuthContext): Promise<KnowledgeFeedbackRecord> {
    this.ensureEnabled();
    try {
      assertFeedbackAuthorized(auth);
    } catch (err) {
      throw mapAuthError(err);
    }
    const parsed = KnowledgeFeedbackSubmitRequestSchema.safeParse(raw);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues[0]?.message ?? "invalid feedback payload");
    }
    const req: KnowledgeFeedbackSubmitRequest = parsed.data;
    const row = await this.repository.insert({
      ...(req.comment !== undefined ? { comment: req.comment } : {}),
      hitChunkIds: req.hitChunkIds ?? [],
      query: req.query,
      subjectId: auth.subjectId ?? null,
      tenantId: auth.tenantId,
      traceId: req.traceId,
      type: req.type,
    });
    return toRecord(row);
  }

  public async listByTraceId(traceIdRaw: unknown, auth: KnowledgeFeedbackAuthContext): Promise<KnowledgeFeedbackRecord[]> {
    this.ensureEnabled();
    try {
      assertFeedbackAuthorized(auth);
    } catch (err) {
      throw mapAuthError(err);
    }
    const traceId = typeof traceIdRaw === "string" ? traceIdRaw.trim() : "";
    if (!traceId) {
      throw new BadRequestException("traceId is required");
    }
    const rows = await this.repository.findByTraceId(auth.tenantId, traceId);
    return rows.map(toRecord);
  }

  public async dashboard(auth: KnowledgeFeedbackAuthContext, options?: { days?: number; topBadLimit?: number }) {
    this.ensureEnabled();
    try {
      assertFeedbackAuthorized(auth);
    } catch (err) {
      throw mapAuthError(err);
    }
    return this.metricsQuery.dashboard(auth.tenantId, options);
  }

  private ensureEnabled(): void {
    if (!this.config.searchFeedbackEnabled) {
      throw new BadRequestException("search feedback is disabled (KB_SEARCH_FEEDBACK_ENABLED=false)");
    }
  }
}

function toRecord(row: SearchFeedbackRow): KnowledgeFeedbackRecord {
  return {
    ...(row.comment !== undefined ? { comment: row.comment } : {}),
    createdAt: row.createdAt,
    hitChunkIds: row.hitChunkIds,
    id: row.id,
    query: row.query,
    tenantId: row.tenantId,
    traceId: row.traceId,
    type: row.type,
  };
}

function mapAuthError(err: unknown): Error {
  if (err instanceof FeedbackUnauthorizedError) {
    return new UnauthorizedException(err.message);
  }
  return err instanceof Error ? err : new UnauthorizedException("unauthorized");
}
