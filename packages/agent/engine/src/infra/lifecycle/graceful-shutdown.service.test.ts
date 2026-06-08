/**
 * GracefulShutdownService 单测 — drain / turn 等待 / exit + shutdown hook 编排（T05）
 *
 * NOTE: process.exit(0) is mocked to prevent test runner from exiting.
 */
import {
  describe,
  it,
  expect,
  mock,
  beforeEach,
  afterEach,
  spyOn,
} from 'bun:test';
import { DrainService } from '@cube-ai/bun-server-ext-sse';

import { LoggerFactory } from '../observability/logger.factory';
import { GracefulShutdownService } from './graceful-shutdown.service';
import { ShutdownRegistry } from './shutdown-registry';

process.env.AGENTIC_ENGINE_PRE_DRAIN_SLEEP_MS = '0';

describe('GracefulShutdownService', () => {
  let drainService: DrainService;
  let readinessState: { ready: boolean };
  let registry: ShutdownRegistry;
  let svc: GracefulShutdownService;
  let exitSpy: ReturnType<typeof spyOn>;

  const loggerFactory = {
    getLogger: () => ({
      info: mock(() => {}),
      error: mock(() => {}),
      warn: mock(() => {}),
    }),
  } as unknown as LoggerFactory;

  const turnRegistry = { getActiveCount: () => 0 };

  beforeEach(() => {
    drainService = new DrainService();
    readinessState = { ready: true };
    registry = new ShutdownRegistry();
    svc = new GracefulShutdownService(
      drainService,
      loggerFactory,
      turnRegistry,
      registry,
      readinessState,
    );

    exitSpy = spyOn(process, 'exit').mockImplementation((() => {}) as never);
  });

  afterEach(() => {
    exitSpy.mockRestore();
  });

  it('shutdown sets readinessState.ready = false', async () => {
    spyOn(drainService, 'waitForDrain').mockResolvedValue(undefined);
    spyOn(drainService, 'broadcastDraining').mockImplementation(() => {});

    await svc.shutdown('sigterm');

    expect(readinessState.ready).toBe(false);
  });

  it('shutdown calls broadcastDraining + waitForDrain before process.exit', async () => {
    const callOrder: string[] = [];
    spyOn(drainService, 'broadcastDraining').mockImplementation(() => {
      callOrder.push('broadcastDraining');
    });
    spyOn(drainService, 'waitForDrain').mockImplementation(async () => {
      callOrder.push('waitForDrain');
    });

    await svc.shutdown('sigterm');

    expect(callOrder).toContain('broadcastDraining');
    expect(callOrder).toContain('waitForDrain');
    expect(callOrder.indexOf('broadcastDraining')).toBeLessThan(callOrder.indexOf('waitForDrain'));
  });

  it('shutdown calls process.exit(0) when complete', async () => {
    spyOn(drainService, 'broadcastDraining').mockImplementation(() => {});
    spyOn(drainService, 'waitForDrain').mockResolvedValue(undefined);

    await svc.shutdown('sigterm');

    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('shutdown is idempotent — second call is a no-op', async () => {
    const broadcastSpy = spyOn(drainService, 'broadcastDraining').mockImplementation(
      () => {},
    );
    spyOn(drainService, 'waitForDrain').mockResolvedValue(undefined);

    await svc.shutdown('sigterm');
    await svc.shutdown('sigterm');

    expect(broadcastSpy).toHaveBeenCalledTimes(1);
  });

  it('accepts sigint reason', async () => {
    spyOn(drainService, 'broadcastDraining').mockImplementation(() => {});
    spyOn(drainService, 'waitForDrain').mockResolvedValue(undefined);

    await svc.shutdown('sigint');

    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  // ─── Shutdown hooks (T05) ──────────────────────────────────────────────────

  it('runs registered hooks in priority-descending order', async () => {
    spyOn(drainService, 'broadcastDraining').mockImplementation(() => {});
    spyOn(drainService, 'waitForDrain').mockResolvedValue(undefined);

    const order: string[] = [];
    registry.register({
      name: 'low',
      priority: 100,
      close: async () => {
        order.push('low');
      },
    });
    registry.register({
      name: 'high',
      priority: 200,
      close: async () => {
        order.push('high');
      },
    });
    registry.register({
      name: 'mid',
      priority: 150,
      close: async () => {
        order.push('mid');
      },
    });

    await svc.shutdown('sigterm');

    expect(order).toEqual(['high', 'mid', 'low']);
  });

  it('continues running remaining hooks when one throws', async () => {
    spyOn(drainService, 'broadcastDraining').mockImplementation(() => {});
    spyOn(drainService, 'waitForDrain').mockResolvedValue(undefined);

    const order: string[] = [];
    registry.register({
      name: 'first',
      priority: 200,
      close: async () => {
        order.push('first');
        throw new Error('boom');
      },
    });
    registry.register({
      name: 'second',
      priority: 100,
      close: async () => {
        order.push('second');
      },
    });

    await svc.shutdown('sigterm');

    expect(order).toEqual(['first', 'second']);
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('runs no hooks when registry is empty', async () => {
    spyOn(drainService, 'broadcastDraining').mockImplementation(() => {});
    spyOn(drainService, 'waitForDrain').mockResolvedValue(undefined);

    await svc.shutdown('sigterm');

    expect(registry.list()).toHaveLength(0);
    expect(exitSpy).toHaveBeenCalledWith(0);
  });
});
