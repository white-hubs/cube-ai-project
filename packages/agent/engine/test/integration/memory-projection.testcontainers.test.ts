import { DEFAULT_ADAPTER_CALL_CONTEXT } from "@tachu/core";
import { projectMemoryRefs } from "@tachu/extensions/memory";
import { afterAll, beforeAll, describe, expect, it, setDefaultTimeout } from "bun:test";
import { createPool } from "mysql2/promise";

import { TurnAwareEmbeddingRuntime } from "@cube-ai/agent-engine/adapters/embedding";
import { MysqlProjectionOutbox, RedisMemoryStore, RedisProjectedMemorySystem } from "@cube-ai/agent-engine/adapters/memory";
import { CubeQdrantMemoryIndex } from "@cube-ai/agent-engine/adapters/vector";
import { type EmbeddingPort } from "@cube-ai/contracts/platform";
import {
  type MysqlRedisQdrantStack,
  applyMinimalMysqlSchema,
  registerProcessShutdown,
  resolveShouldRunTestcontainers,
  startMysqlRedisQdrant,
  stopTrackedTestcontainersIfAny,
} from "@cube-ai/test-infra";

import { MemoryProjectionRelayService } from "../../src/infra/memory-projection/memory-projection-relay.service";

/**
 * Memory projection end-to-end: Redis append → archive → relay flush → Qdrant searchVector.
 *
 *   USE_TESTCONTAINERS=1 bun test packages/agent/engine/test/integration/memory-projection.testcontainers.test.ts
 */

const run = await resolveShouldRunTestcontainers();
const stackHolder: { current: MysqlRedisQdrantStack | null } = { current: null };

if (run) {
  setDefaultTimeout(3_600_000);
  registerProcessShutdown(
    async () => {
      await stopTrackedTestcontainersIfAny();
      if (stackHolder.current) {
        await stackHolder.current.stop().catch(() => {});
        stackHolder.current = null;
      }
    },
    { exitProcessAfterSignal: true },
  );
}

const DIM = 8;
const TENANT = 9014;

function stubEmbeddingPort(): EmbeddingPort {
  return {
    dimension: DIM,
    async embed(inputs) {
      return inputs.map((text) => ({
        dense: Array.from({ length: DIM }, (_, i) => (text.length > 0 ? 0.12 : 0.01) + i * 0.01),
        sparse: null,
      }));
    },
  };
}

if (run) {
  describe("memory projection e2e (testcontainers)", () => {
    beforeAll(
      async () => {
        stackHolder.current = await startMysqlRedisQdrant();
        await applyMinimalMysqlSchema(stackHolder.current.mysqlUrl);
      },
      { timeout: 1_800_000 },
    );

    afterAll(
      async () => {
        if (stackHolder.current) {
          await stackHolder.current.stop();
          stackHolder.current = null;
        }
      },
      { timeout: 120_000 },
    );

    it("append → archive → relay flush → searchVector 命中", async () => {
      const stack = stackHolder.current!;
      const pool = createPool(stack.mysqlUrl);
      const outbox = new MysqlProjectionOutbox({ pool, tenantId: TENANT });
      const store = new RedisMemoryStore({
        redisUrl: stack.redisUrl,
        tenantId: TENANT,
        ttlSeconds: 3600,
      });
      const memory = new RedisProjectedMemorySystem({ outbox, store });

      const ctx = {
        ...DEFAULT_ADAPTER_CALL_CONTEXT,
        correlation: {
          ...DEFAULT_ADAPTER_CALL_CONTEXT.correlation,
          sessionId: "proj-sess-1",
        },
        tenant: TENANT,
      };
      const embedding = new TurnAwareEmbeddingRuntime({
        defaultModel: "stub-embed-model",
        dimensions: DIM,
        embeddingPort: stubEmbeddingPort(),
        getTurnContext: () => ctx,
        resolveModelCode: () => "stub-embed-model",
      });
      const vectorIndex = new CubeQdrantMemoryIndex({
        searchTenant: TENANT,
        url: stack.qdrantUrl,
        vectorSize: DIM,
      });

      const sessionId = `sess-proj-${Date.now()}`;
      const entryId = `entry-${Date.now()}`;
      await memory.append(
        sessionId,
        {
          anchored: false,
          content: "projection e2e memory content",
          id: entryId,
          role: "user",
          timestamp: Date.now(),
        },
        ctx,
      );

      memory.bindProjectionProject((sid, refs, signal) =>
        projectMemoryRefs(
          {
            embedding,
            loadEntry: async (loadSid, ref) => {
              const entries = await memory.loadFull(loadSid);
              const entry = entries.find((e) => e.id === ref);
              if (!entry) {
                return null;
              }
              const content = typeof entry.content === "string" ? entry.content : JSON.stringify(entry.content ?? "");
              return { entry, content };
            },
            vectorIndex,
          },
          sid,
          refs,
          ctx,
          signal,
        ),
      );

      await memory.archive(sessionId);

      const relay = new MemoryProjectionRelayService();
      relay.attachWorker(memory.createProjectionWorker({ intervalMs: 200 }));
      await relay.start(undefined, { skipLeaderElection: true });
      const flushResult = await relay.flush(sessionId);
      await relay.stop();

      expect(flushResult.projected).toBeGreaterThanOrEqual(1);

      const queryVec = (await embedding.embed({ inputs: ["projection e2e"], model: "stub-embed-model", taskType: "RETRIEVAL_QUERY" }, ctx))
        .embeddings[0]!;
      const hits = await vectorIndex.searchVector(queryVec, 5, { must: { sessionId, tenant: TENANT } }, ctx);
      expect(hits.length).toBeGreaterThanOrEqual(1);

      await pool.end();
      await store.dispose();
    });
  });
} else {
  describe("memory projection e2e (testcontainers)", () => {
    it("skipped without USE_TESTCONTAINERS=1", () => {
      expect(true).toBe(true);
    });
  });
}
