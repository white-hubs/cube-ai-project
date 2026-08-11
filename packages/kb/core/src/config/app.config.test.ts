import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { loadAppConfigSync, resetAppConfigCache, resetRuleBoostDeprecationWarnForTests } from "./app.config";

const ENV_KEYS = [
  "RETRIEVAL_RULE_BOOST_ENABLED",
  "RETRIEVAL_RERANK_ENABLED",
  "RETRIEVAL_MODEL_RERANK_ENABLED",
  "RETRIEVAL_RERANK_INPUT_TOP_N",
  "RETRIEVAL_RERANK_MODEL",
  "RETRIEVAL_RERANK_MIN_SCORE",
  "RETRIEVAL_DIVERSIFICATION_ENABLED",
  "RETRIEVAL_MMR_LAMBDA",
  "RETRIEVAL_MAX_CHUNKS_PER_SECTION",
  "RETRIEVAL_EXACT_MATCH_RESERVE",
  "LEXICAL_FULLTEXT_ENABLED",
  "KB_SEARCH_FEEDBACK_ENABLED",
  "INGESTION_ASYNC_ENABLED",
] as const;

const saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
    delete Bun.env[key];
  }
  resetAppConfigCache();
  resetRuleBoostDeprecationWarnForTests();
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = saved[key];
    if (value === undefined) {
      delete process.env[key];
      delete Bun.env[key];
    } else {
      process.env[key] = value;
      Bun.env[key] = value;
    }
  }
  resetAppConfigCache();
  resetRuleBoostDeprecationWarnForTests();
});

describe("kb AppConfig retrieval flags (W2.2)", () => {
  test("model rerank defaults off and quality-selection defaults are explicit", () => {
    const config = loadAppConfigSync();
    expect(config.retrievalModelRerankEnabled).toBe(false);
    expect(config.retrievalRerankInputTopN).toBe(50);
    expect(config.retrievalRerankModel).toBe("qwen3-rerank");
    expect(config.retrievalRerankMinScore).toBe(0.65);
    expect(config.retrievalDiversificationEnabled).toBe(false);
    expect(config.retrievalMmrLambda).toBe(0.75);
    expect(config.retrievalMaxChunksPerSection).toBe(1);
    expect(config.retrievalExactMatchReserve).toBe(1);
  });

  test("H5: legacy RETRIEVAL_RERANK_ENABLED alone still enables rule boost", () => {
    process.env.RETRIEVAL_RERANK_ENABLED = "true";
    Bun.env.RETRIEVAL_RERANK_ENABLED = "true";
    const config = loadAppConfigSync();
    expect(config.retrievalRerankEnabled).toBe(true);
  });

  test("RETRIEVAL_RULE_BOOST_ENABLED preferred over legacy name", () => {
    process.env.RETRIEVAL_RULE_BOOST_ENABLED = "false";
    Bun.env.RETRIEVAL_RULE_BOOST_ENABLED = "false";
    process.env.RETRIEVAL_RERANK_ENABLED = "true";
    Bun.env.RETRIEVAL_RERANK_ENABLED = "true";
    const config = loadAppConfigSync();
    expect(config.retrievalRerankEnabled).toBe(false);
  });

  test("RETRIEVAL_MODEL_RERANK_ENABLED can be turned on explicitly", () => {
    process.env.RETRIEVAL_MODEL_RERANK_ENABLED = "true";
    Bun.env.RETRIEVAL_MODEL_RERANK_ENABLED = "true";
    process.env.RETRIEVAL_RERANK_INPUT_TOP_N = "30";
    Bun.env.RETRIEVAL_RERANK_INPUT_TOP_N = "30";
    process.env.RETRIEVAL_RERANK_MODEL = "qwen3-rerank";
    Bun.env.RETRIEVAL_RERANK_MODEL = "qwen3-rerank";
    process.env.RETRIEVAL_RERANK_MIN_SCORE = "0.7";
    Bun.env.RETRIEVAL_RERANK_MIN_SCORE = "0.7";
    process.env.RETRIEVAL_DIVERSIFICATION_ENABLED = "true";
    Bun.env.RETRIEVAL_DIVERSIFICATION_ENABLED = "true";
    const config = loadAppConfigSync();
    expect(config.retrievalModelRerankEnabled).toBe(true);
    expect(config.retrievalRerankInputTopN).toBe(30);
    expect(config.retrievalRerankModel).toBe("qwen3-rerank");
    expect(config.retrievalRerankMinScore).toBe(0.7);
    expect(config.retrievalDiversificationEnabled).toBe(true);
  });
});

describe("kb AppConfig lexical fulltext flag (W3.4)", () => {
  test("LEXICAL_FULLTEXT_ENABLED defaults off (G0-9)", () => {
    const config = loadAppConfigSync();
    expect(config.lexicalFulltextEnabled).toBe(false);
  });

  test("LEXICAL_FULLTEXT_ENABLED can be turned on explicitly", () => {
    process.env.LEXICAL_FULLTEXT_ENABLED = "true";
    Bun.env.LEXICAL_FULLTEXT_ENABLED = "true";
    const config = loadAppConfigSync();
    expect(config.lexicalFulltextEnabled).toBe(true);
  });
});

describe("kb AppConfig feedback flag (W4.2)", () => {
  test("KB_SEARCH_FEEDBACK_ENABLED defaults off", () => {
    expect(loadAppConfigSync().searchFeedbackEnabled).toBe(false);
  });

  test("feedback can only be enabled explicitly", () => {
    process.env.KB_SEARCH_FEEDBACK_ENABLED = "true";
    Bun.env.KB_SEARCH_FEEDBACK_ENABLED = "true";
    expect(loadAppConfigSync().searchFeedbackEnabled).toBe(true);
  });
});

describe("kb AppConfig ingestion mode (W3.3 rollout)", () => {
  test("upload/reindex default to synchronous ingestion", () => {
    expect(loadAppConfigSync().ingestionAsyncEnabled).toBe(false);
  });

  test("async ingestion requires an explicit opt-in", () => {
    process.env.INGESTION_ASYNC_ENABLED = "true";
    Bun.env.INGESTION_ASYNC_ENABLED = "true";
    expect(loadAppConfigSync().ingestionAsyncEnabled).toBe(true);
  });
});
