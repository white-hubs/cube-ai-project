import "./otel-preload";
import "reflect-metadata";
// Keep mysql2 in the compiled graph for direct app-owned adapters. Bun Server's
// dynamic createRequire('mysql2/promise') path is avoided in prebuilt mode.
import "mysql2/promise";
import { OutboxRelayService } from "@cube-ai/bun-server-ext-outbox";

import { GracefulShutdownService, bootstrap } from "./bootstrap";

const startedAt = Date.now();

try {
  const app = await bootstrap();
  const server = app.getServer();
  const port = server?.getPort?.() ?? Number(Bun.env.AI_CENTER_PORT ?? Bun.env.AGENTIC_ENGINE_PORT ?? 3000);
  const hostname = server?.getHostname?.() ?? "0.0.0.0";
  const boot = Date.now() - startedAt;

  process.stdout.write(
    `${JSON.stringify({
      msg: "ai-center.listening",
      url: `http://${hostname}:${port}`,
      bootMs: boot,
      ts: startedAt,
    })}\n`,
  );

  const graceful = app.getContainer().resolve(GracefulShutdownService) as GracefulShutdownService;
  graceful.registerProcessSignalHandlers();

  // KB ingest/reconcile use the persistent outbox. Start the relay only after
  // HTTP is accepting requests so Redis leader election cannot block bootstrap.
  const relayFlag = (Bun.env.AGENTIC_ENGINE_ENABLE_OUTBOX_RELAY ?? process.env.AGENTIC_ENGINE_ENABLE_OUTBOX_RELAY)?.trim().toLowerCase();
  const enableOutboxRelay = relayFlag !== "0" && relayFlag !== "false";
  if (enableOutboxRelay) {
    const relay = app.getContainer().resolve(OutboxRelayService) as OutboxRelayService;
    process.stdout.write(`${JSON.stringify({ msg: "ai-center.outbox-relay.starting" })}\n`);
    void relay.start().then(
      () => process.stdout.write(`${JSON.stringify({ msg: "ai-center.outbox-relay.started" })}\n`),
      (error: unknown) => console.error("[ai-center] outbox relay start failed", error instanceof Error ? error : new Error(String(error))),
    );
  } else {
    process.stdout.write(`${JSON.stringify({ msg: "ai-center.outbox-relay.disabled" })}\n`);
  }
} catch (err) {
  console.error("[ai-center] bootstrap failed", err);
  process.exit(1);
}
