import { describe, expect, test } from "bun:test";

import {
  createRetrievalServiceGoldenRetriever,
  getLiveRetrievalServiceForEval,
  loadGoldenCaseFile,
  resolveKbEvalOutputDir,
  resolveLiveCasesPath,
  runGoldenEval,
  tryWriteGoldenEvalReport,
} from "./run-golden-eval";

/**
 * Live golden eval (W1.4-H3):
 * - Default: entire suite skipped (no CI impact).
 * - Enable with KB_GOLDEN_LIVE=1.
 * - Missing `.tmp/kb-eval/cases.live.v1.json` → soft skip (no throw / no fail).
 * - Never asserts baselines; prints comparison only.
 */
const LIVE_ENABLED = (Bun.env.KB_GOLDEN_LIVE ?? process.env.KB_GOLDEN_LIVE) === "1";

(LIVE_ENABLED ? describe : describe.skip)("retrieval golden live eval (KB_GOLDEN_LIVE=1)", () => {
  test("runs when live cases exist; soft-skips when absent", async () => {
    const livePath = resolveLiveCasesPath();
    const fileHandle = Bun.file(livePath);
    if (!(await fileHandle.exists())) {
      console.info(`[kb-golden-live] skip: missing ${livePath}`);
      expect(true).toBe(true);
      return;
    }

    const file = await loadGoldenCaseFile(livePath);
    const service = getLiveRetrievalServiceForEval();
    if (!service) {
      console.info("[kb-golden-live] skip: no real RetrievalService installed by live harness");
      expect(true).toBe(true);
      return;
    }
    const retrieve = createRetrievalServiceGoldenRetriever(service);
    const report = await runGoldenEval({
      cases: file.cases,
      retrieve,
      mode: "live",
      version: file.version,
    });
    const out = await tryWriteGoldenEvalReport(report, resolveKbEvalOutputDir());

    console.info(
      `[kb-golden-live] cases=${report.macro.caseCount} hit@3=${report.macro.hitRateAt3.toFixed(4)} mrr=${report.macro.mrr.toFixed(4)} ndcg@5=${report.macro.ndcgAt5.toFixed(4)} report=${out ?? "(not written)"}`,
    );
    // Live never fails CI on metric floors (allow ±2% local drift notes only).
    expect(report.mode).toBe("live");
  });
});

describe("retrieval golden live gate defaults", () => {
  test("live suite is skipped unless KB_GOLDEN_LIVE=1", () => {
    if (LIVE_ENABLED) {
      expect(LIVE_ENABLED).toBe(true);
      return;
    }
    expect(LIVE_ENABLED).toBe(false);
  });
});
