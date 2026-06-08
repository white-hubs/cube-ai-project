import { Injectable } from '@dangao/bun-server';
import { LoggerFactory } from '../../infra/observability/logger.factory';
import { LocalFileService } from './local-file.service';

const DEFAULT_GC_INTERVAL_MS = 5 * 60 * 1000;

@Injectable()
export class LocalFileGc {
  private timer: ReturnType<typeof setInterval> | undefined;
  private readonly intervalMs: number;
  private readonly log;

  constructor(
    private readonly files: LocalFileService,
    private readonly loggerFactory: LoggerFactory,
  ) {
    this.log = this.loggerFactory.getLogger('agentic.engine.files.local-file-gc');
    this.intervalMs =
      Number(process.env['AGENTIC_ENGINE_LOCAL_FILE_GC_INTERVAL_SECONDS'] ?? '300') * 1000 ||
      DEFAULT_GC_INTERVAL_MS;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.runOnce();
    }, this.intervalMs);
  }

  async stop(): Promise<void> {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = undefined;
  }

  async runOnce(): Promise<void> {
    const result = await this.files.collectExpiredUnboundAssets();
    if (result.deletedFileIds.length > 0) {
      this.log.info({ count: result.deletedFileIds.length }, 'local file gc deleted expired unbound assets');
    }
  }
}
