import { JobSchema, type Job } from '@cube-ai/contracts';
import type { AgenticClient } from './client';
import type { AgenticClientConfig } from './client';

/**
 * Jobs API for long-running tool management.
 * Ref: docs/detailed-design/08-sdk/sdk-core.md §2.2
 */
export class JobsApi {
  constructor(
    _config: AgenticClientConfig,
    private readonly client: AgenticClient,
  ) {}

  async get(jobId: string): Promise<Job> {
    const raw = await this.client.requestJson<unknown>({
      method: 'GET',
      path:   `/v1/jobs/${jobId}`,
    });
    return JobSchema.parse(raw);
  }

  async cancel(jobId: string, opts?: { reason?: string }): Promise<void> {
    await this.client.requestJson({
      method: 'POST',
      path:   `/v1/jobs/${jobId}:cancel`,
      body:   opts?.reason ? { reason: opts.reason } : {},
    });
  }
}
