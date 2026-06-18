import { Injectable } from '@dangao/bun-server';
import { DescriptorRegistryService } from '../descriptor/descriptor-registry.service';
import { McpBridgeService } from './mcp-bridge.service';

const RETRY_DELAYS_MS = [10_000, 30_000, 60_000, 300_000] as const;

export type McpToolRegistrationState = 'pending' | 'registered' | 'degraded';

export interface McpToolRegistrationServerStatus {
  serverName: string;
  enabled: boolean;
  required: boolean;
  state: McpToolRegistrationState;
  registeredToolCount: number;
  failureCount: number;
  lastError?: string;
  lastAttemptAt?: number;
  lastSuccessAt?: number;
  nextRetryAt?: number;
}

export interface McpToolRegistrationStatus {
  status: 'UP' | 'DOWN';
  servers: Record<string, McpToolRegistrationServerStatus>;
}

@Injectable()
export class McpToolRegistrationWorker {
  private readonly servers = new Map<string, McpToolRegistrationServerStatus>();
  private running = false;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly bridge: McpBridgeService,
    private readonly registry: DescriptorRegistryService,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.runDueServersSafely();
  }

  stop(): void {
    this.running = false;
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  async runOnce(): Promise<void> {
    await this.refreshServerList();
    await Promise.all(
      [...this.servers.keys()].map((serverName) => this.tryRegisterServer(serverName)),
    );
    this.scheduleNext();
  }

  status(): McpToolRegistrationStatus {
    const servers = Object.fromEntries(
      [...this.servers.entries()].map(([name, status]) => [name, { ...status }]),
    );
    const requiredDown = Object.values(servers).some(
      (server) => server.enabled && server.required && server.state !== 'registered',
    );
    return { status: requiredDown ? 'DOWN' : 'UP', servers };
  }

  private async runDueServers(): Promise<void> {
    if (!this.running) return;
    await this.refreshServerList();
    const now = Date.now();
    const due = [...this.servers.values()]
      .filter((server) => server.enabled)
      .filter((server) => server.nextRetryAt === undefined || server.nextRetryAt <= now)
      .map((server) => server.serverName);

    await Promise.all(due.map((serverName) => this.tryRegisterServer(serverName)));
    this.scheduleNext();
  }

  private async refreshServerList(): Promise<void> {
    const configured = await this.bridge.configuredServers();
    for (const [serverName, cfg] of configured) {
      const existing = this.servers.get(serverName);
      const required = cfg.required === true;
      if (existing) {
        existing.enabled = cfg.enabled;
        existing.required = required;
        continue;
      }
      this.servers.set(serverName, {
        serverName,
        enabled: cfg.enabled,
        required,
        state: 'pending',
        registeredToolCount: 0,
        failureCount: 0,
      });
    }
  }

  private async tryRegisterServer(serverName: string): Promise<void> {
    const status = this.servers.get(serverName);
    if (!status?.enabled) return;
    status.lastAttemptAt = Date.now();
    try {
      const tools = await this.bridge.listToolsForServer(serverName);
      let registered = 0;
      for (const tool of tools) {
        if (this.registry.resolve(tool.name)) continue;
        try {
          this.registry.register(tool);
          registered++;
        } catch (e) {
          console.warn(
            `[mcp-registration] skip descriptor server=${serverName} tool=${tool.name}: ${errorMessage(e)}`,
          );
        }
      }
      status.state = 'registered';
      status.registeredToolCount = tools.length;
      status.failureCount = 0;
      status.lastError = undefined;
      status.lastSuccessAt = Date.now();
      status.nextRetryAt = undefined;
      console.info(
        `[mcp-registration] server registered server=${serverName} tools=${tools.length} newlyRegistered=${registered}`,
      );
    } catch (e) {
      status.state = 'degraded';
      status.failureCount += 1;
      status.lastError = errorMessage(e);
      const delayMs = retryDelayMs(status.failureCount);
      status.nextRetryAt = Date.now() + delayMs;
      console.warn(
        `[mcp-registration] server degraded server=${serverName} required=${status.required} attempt=${status.failureCount} nextRetryMs=${delayMs} error=${status.lastError}`,
      );
    }
  }

  private scheduleNext(): void {
    if (!this.running) return;
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    const now = Date.now();
    const nextRetryAt = [...this.servers.values()]
      .filter((server) => server.enabled)
      .map((server) => server.nextRetryAt ?? now + RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1])
      .reduce<number | undefined>((min, next) => (min === undefined ? next : Math.min(min, next)), undefined);
    const delay = Math.max(1, (nextRetryAt ?? now + RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1]) - now);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.runDueServersSafely();
    }, delay);
  }

  private runDueServersSafely(): void {
    this.runDueServers().catch((e) => {
      console.warn(
        `[mcp-registration] worker loop failed error=${errorMessage(e)}`,
      );
      this.scheduleNext();
    });
  }
}

export function retryDelayMs(failureCount: number): number {
  return RETRY_DELAYS_MS[Math.min(Math.max(failureCount, 1), RETRY_DELAYS_MS.length) - 1]!;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
