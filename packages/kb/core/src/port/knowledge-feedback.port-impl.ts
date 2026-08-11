import { Inject, Injectable } from "@dangao/bun-server";

import {
  type KnowledgeFeedbackAuthContext,
  type KnowledgeFeedbackPort,
  type KnowledgeFeedbackRecord,
  type KnowledgeFeedbackSubmitRequest,
} from "@cube-ai/contracts/platform";
import { tenantContextAls } from "@cube-ai/tenant-context";

import { SearchFeedbackService } from "../modules/vector-store/feedback/search-feedback.service";

/**
 * Agent / event bypass shares SearchFeedbackService (+ repository) with HTTP (W4.2 extension point).
 */
@Injectable()
export class KnowledgeFeedbackPortImpl implements KnowledgeFeedbackPort {
  public constructor(@Inject(SearchFeedbackService) private readonly feedbackService: SearchFeedbackService) {}

  public async submit(req: KnowledgeFeedbackSubmitRequest, auth: KnowledgeFeedbackAuthContext): Promise<KnowledgeFeedbackRecord> {
    const tenantId = auth.tenantId?.trim();
    if (!tenantId) {
      return this.feedbackService.submit(req, auth);
    }
    return tenantContextAls.run({ tenantId }, () => this.feedbackService.submit(req, { ...auth, tenantId }));
  }

  public async listByTraceId(traceId: string, auth: KnowledgeFeedbackAuthContext): Promise<KnowledgeFeedbackRecord[]> {
    const tenantId = auth.tenantId?.trim();
    if (!tenantId) {
      return this.feedbackService.listByTraceId(traceId, auth);
    }
    return tenantContextAls.run({ tenantId }, () => this.feedbackService.listByTraceId(traceId, { ...auth, tenantId }));
  }
}
