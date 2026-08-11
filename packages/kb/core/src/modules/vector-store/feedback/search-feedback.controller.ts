import {
  ApiBody,
  ApiOperation,
  ApiResponse,
  BadRequestException,
  Body,
  ContextParam,
  Controller,
  GET,
  POST,
  Query,
  type Context,
} from "@dangao/bun-server";

import { currentTenantId } from "@cube-ai/tenant-context";

import { resolveFeedbackAuthFromTrustedContext } from "./search-feedback-auth";
import { SearchFeedbackService } from "./search-feedback.service";

@Controller("/search")
export class SearchFeedbackController {
  public constructor(private readonly feedbackService: SearchFeedbackService) {}

  @ApiOperation({
    description:
      "写入检索反馈（thumbs_up / thumbs_down / wrong_citation / missed_source）。traceId 须与检索请求 KnowledgeQueryRequest.traceId / search 回显一致。",
    operationId: "submitSearchFeedback",
    summary: "检索反馈写入",
  })
  @ApiBody({
    description: "反馈载荷",
    required: true,
    schema: {
      properties: {
        comment: { description: "可选备注", type: "string" },
        hitChunkIds: { description: "命中/引用的 chunkId 列表", items: { type: "string" }, type: "array" },
        query: { description: "检索 query", type: "string" },
        traceId: { description: "与检索调用对齐的 traceId", type: "string" },
        type: {
          description: "反馈类型",
          enum: ["thumbs_up", "thumbs_down", "wrong_citation", "missed_source"],
          type: "string",
        },
      },
      required: ["traceId", "query", "type"],
      type: "object",
    },
  })
  @ApiResponse({ description: "已写入的反馈记录", status: 200 })
  @POST("/feedback")
  public async submit(@Body() body: unknown, @ContextParam() ctx: Context) {
    return this.feedbackService.submit(body, this.authFromCtx(ctx));
  }

  @ApiOperation({
    description: "按 traceId 查回反馈记录（租户隔离）。",
    operationId: "listSearchFeedbackByTrace",
    summary: "按 traceId 查询反馈",
  })
  @ApiResponse({ description: "反馈列表", status: 200 })
  @GET("/feedback")
  public async listByTrace(@Query("traceId") traceId: string | undefined, @ContextParam() ctx: Context) {
    const items = await this.feedbackService.listByTraceId(traceId, this.authFromCtx(ctx));
    return { items };
  }

  @ApiOperation({
    description: "最小仪表：按日反馈率 + top 差查询 + hit chunk recall_count 观测（内部）。",
    operationId: "searchFeedbackMetrics",
    summary: "反馈观测仪表",
  })
  @ApiResponse({ description: "聚合结果", status: 200 })
  @GET("/feedback/metrics")
  public async metrics(
    @Query("days") daysRaw: string | undefined,
    @Query("topBadLimit") topBadLimitRaw: string | undefined,
    @ContextParam() ctx: Context,
  ) {
    const days = parsePositiveInt(daysRaw, 7);
    const topBadLimit = parsePositiveInt(topBadLimitRaw, 10);
    return this.feedbackService.dashboard(this.authFromCtx(ctx), { days, topBadLimit });
  }

  private authFromCtx(ctx: Context) {
    void ctx;
    return resolveFeedbackAuthFromTrustedContext({
      tenantId: currentTenantId(),
    });
  }
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === null || String(raw).trim() === "") {
    return fallback;
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    throw new BadRequestException("days/topBadLimit must be a positive number");
  }
  return Math.floor(n);
}
