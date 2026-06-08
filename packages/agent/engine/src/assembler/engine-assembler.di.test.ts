import 'reflect-metadata';
import { describe, expect, it } from 'bun:test';
import { EngineAssembler } from './engine-assembler';
import {
  SNAPSHOT_SERVICE_TOKEN,
  TURN_LOCK_SERVICE_TOKEN,
  TURN_REPO_TOKEN,
} from '../bc/session/session.tokens';
import { SnapshotService } from '../bc/session/snapshot.service';
import { TurnLockService } from '../bc/session/turn-lock.service';
import { TurnRepository } from '../bc/session/turn.repository';
import { DI_METRICS_REGISTRY, MetricsRegistry } from '../infra/observability/metrics-registry';

const ENV_KEYS = [
  'AGENTIC_ENGINE_MYSQL_URL',
  'AGENTIC_ENGINE_MYSQL_DSN',
  'AGENTIC_ENGINE_REDIS_URL',
  'REDIS_URL',
  'BUN_REDIS_URL',
] as const;

function withIsolatedInfraEnv(fn: () => void): void {
  const prev = new Map<string, string | undefined>();
  for (const key of ENV_KEYS) {
    prev.set(key, process.env[key]);
    delete process.env[key];
  }
  try {
    fn();
  } finally {
    for (const key of ENV_KEYS) {
      const value = prev.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

describe('EngineAssembler DI aliases', () => {
  it('registers Symbol token aliases via useExisting', () => {
    withIsolatedInfraEnv(() => {
      const app = new EngineAssembler().assemble();
      const container = app.getContainer();

      expect(container.resolve(TURN_LOCK_SERVICE_TOKEN)).toBeInstanceOf(TurnLockService);
      expect(container.resolve(TURN_REPO_TOKEN)).toBeInstanceOf(TurnRepository);
      expect(container.resolve(SNAPSHOT_SERVICE_TOKEN)).toBeInstanceOf(SnapshotService);
      expect(container.resolve(DI_METRICS_REGISTRY)).toBeInstanceOf(MetricsRegistry);
    });
  });
});
