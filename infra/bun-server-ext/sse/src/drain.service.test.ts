/**
 * Unit tests for DrainService (P1-11)
 *
 * ref: design doc §7 (P1-11)
 * ref: shared-context §4.3 失败单测要求
 *
 * Tests cover:
 *  1. registerStream increments activeStreamCount
 *  2. unregister function decrements count
 *  3. waitForDrain resolves immediately when no active streams
 *  4. broadcastDraining sends drain.mode (drain-mode-v1) to all streams
 *  5. waitForDrain force-closes streams after timeout
 *  6. DrainMode state-machine compatibility (P1-06 interface)
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { DrainService } from './drain.service';
import type { SseConnection } from './drain.service';

describe('DrainService', () => {
  let svc: DrainService;

  beforeEach(() => {
    svc = new DrainService();
  });

  it('should start with activeStreamCount = 0 and not draining', () => {
    expect(svc.activeStreamCount()).toBe(0);
    expect(svc.isDraining()).toBe(false);
  });

  it('registerStream increments activeStreamCount', () => {
    const conn = makeConn();
    svc.registerStream(conn);
    expect(svc.activeStreamCount()).toBe(1);
  });

  it('unregister function decrements activeStreamCount', () => {
    const conn = makeConn();
    const unregister = svc.registerStream(conn);
    expect(svc.activeStreamCount()).toBe(1);
    unregister();
    expect(svc.activeStreamCount()).toBe(0);
  });

  it('multiple streams tracked independently', () => {
    const conn1 = makeConn();
    const conn2 = makeConn();
    const unregister1 = svc.registerStream(conn1);
    svc.registerStream(conn2);
    expect(svc.activeStreamCount()).toBe(2);
    unregister1();
    expect(svc.activeStreamCount()).toBe(1);
  });

  it('waitForDrain resolves immediately when no active streams', async () => {
    const start = Date.now();
    await svc.waitForDrain(5_000);
    // Should not take anywhere near 5s
    expect(Date.now() - start).toBeLessThan(500);
    expect(svc.activeStreamCount()).toBe(0);
  });

  it('starts accepting new SSE streams until drain', () => {
    expect(svc.isAcceptingNewStreams()).toBe(true);
  });

  it('broadcastDraining sends drain.mode event with drain-mode-v1', () => {
    const conn1 = makeConn();
    const conn2 = makeConn();
    svc.registerStream(conn1);
    svc.registerStream(conn2);

    svc.broadcastDraining();

    expect(svc.isDraining()).toBe(true);
    expect(svc.isAcceptingNewStreams()).toBe(false);
    expect(conn1.writeEvent).toHaveBeenCalledWith(
      'drain.mode',
      expect.objectContaining({
        schema: 'drain-mode-v1',
        reason: 'GRACEFUL_SHUTDOWN',
        reconnectHintMs: 1000,
      }),
      'drain',
    );
    expect(conn2.writeEvent).toHaveBeenCalledWith(
      'drain.mode',
      expect.objectContaining({
        schema: 'drain-mode-v1',
      }),
      'drain',
    );
  });

  it('triggerDrain resolves quickly when no SSE connections block', async () => {
    const started = Date.now();
    await svc.triggerDrain(5_000);
    expect(Date.now() - started).toBeLessThan(800);
  });

  it('waitForDrain force-closes remaining streams after timeout', async () => {
    const conn = makeConn(); // conn never calls unregister itself
    svc.registerStream(conn);

    // Use a very short timeout (50ms) so the test doesn't hang
    await svc.waitForDrain(50);

    expect(conn.close).toHaveBeenCalledTimes(1);
    expect(svc.activeStreamCount()).toBe(0);
  });

  it('waitForDrain exits early if streams disconnect during grace window', async () => {
    const conn = makeConn();
    const unregister = svc.registerStream(conn);

    // Simulate stream disconnecting after 20ms
    setTimeout(() => unregister(), 20);

    const start = Date.now();
    await svc.waitForDrain(5_000);
    const elapsed = Date.now() - start;

    // Should have exited well before the 5s timeout
    expect(elapsed).toBeLessThan(500);
    expect(svc.activeStreamCount()).toBe(0);
  });

  // ── DrainMode state-machine (P1-06 compatibility) ───────────────────────

  it('getMode() starts at "running"', () => {
    expect(svc.getMode()).toBe('running');
  });

  it('transition changes mode and notifies listeners', async () => {
    const listener = mock<(m: string) => void>();
    svc.onChange(listener);
    await svc.transition('paused');
    expect(svc.getMode()).toBe('paused');
    expect(listener).toHaveBeenCalledWith('paused');
  });

  it('onChange returns unregister; listener not called after unregister', async () => {
    const listener = mock<(m: string) => void>();
    const unregister = svc.onChange(listener);
    unregister();
    await svc.transition('paused');
    expect(listener).not.toHaveBeenCalled();
  });

  it('broadcastDraining transitions mode to finalize', async () => {
    svc.registerStream(makeConn());
    svc.broadcastDraining();
    // Give microtasks time to run
    await new Promise((r) => setTimeout(r, 0));
    expect(svc.getMode()).toBe('finalize');
  });
});

// ── helpers ────────────────────────────────────────────────────────────────

function makeConn(): SseConnection & {
  writeEvent: ReturnType<typeof mock>;
  close: ReturnType<typeof mock>;
} {
  return {
    writeEvent: mock(),
    close: mock(),
  };
}
