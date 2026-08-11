import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import type { RetrievalService } from "../services/retrieval.service";
import type { CaseMetrics, GoldenCase, GoldenCaseFile, GoldenEvalReport, GoldenRetriever, MacroMetrics } from "./golden-types";
import { aggregateMacroMetrics, computeCaseMetrics } from "./metrics";

const DEFAULT_K = [1, 3, 5] as const;

export function resolveKbEvalOutputDir(cwd: string = process.cwd()): string {
  return join(cwd, ".tmp", "kb-eval");
}

export function resolveGoldenCasesPath(packageRoot: string): string {
  return join(packageRoot, "fixtures", "retrieval-golden", "cases.v1.json");
}

export function resolveLiveCasesPath(cwd: string = process.cwd()): string {
  return join(cwd, ".tmp", "kb-eval", "cases.live.v1.json");
}

export function parseGoldenCaseFile(raw: unknown): GoldenCaseFile {
  if (raw === null || typeof raw !== "object") {
    throw new Error("golden cases: root must be an object");
  }
  const root = raw as Record<string, unknown>;
  if (typeof root.version !== "number") {
    throw new Error("golden cases: version must be a number");
  }
  if (!Array.isArray(root.cases)) {
    throw new Error("golden cases: cases must be an array");
  }

  const cases: GoldenCase[] = root.cases.map((entry, index) => {
    if (entry === null || typeof entry !== "object") {
      throw new Error(`golden cases: cases[${index}] must be an object`);
    }
    const item = entry as Record<string, unknown>;
    if (typeof item.id !== "string" || item.id.trim() === "") {
      throw new Error(`golden cases: cases[${index}].id must be a non-empty string`);
    }
    if (typeof item.query !== "string" || item.query.trim() === "") {
      throw new Error(`golden cases: cases[${index}].query must be a non-empty string`);
    }
    if (typeof item.profileHint !== "string") {
      throw new Error(`golden cases: cases[${index}].profileHint must be a string`);
    }
    const expectNoAnswer = item.expectNoAnswer === true;
    if (!Array.isArray(item.relevant) || (!expectNoAnswer && item.relevant.length === 0)) {
      throw new Error(`golden cases: cases[${index}].relevant must be non-empty unless expectNoAnswer=true`);
    }
    const relevant = item.relevant.map((rel, relIndex) => {
      if (rel === null || typeof rel !== "object") {
        throw new Error(`golden cases: cases[${index}].relevant[${relIndex}] must be an object`);
      }
      const row = rel as Record<string, unknown>;
      if (typeof row.documentId !== "string" || typeof row.chunkId !== "string" || typeof row.grade !== "number") {
        throw new Error(`golden cases: cases[${index}].relevant[${relIndex}] needs documentId/chunkId/grade`);
      }
      return { documentId: row.documentId, chunkId: row.chunkId, grade: row.grade };
    });

    const k = Array.isArray(item.k) ? item.k.filter((value): value is number => typeof value === "number") : undefined;
    return {
      id: item.id,
      query: item.query,
      profileHint: item.profileHint as GoldenCase["profileHint"],
      relevant,
      ...(expectNoAnswer ? { expectNoAnswer: true } : {}),
      ...(k && k.length > 0 ? { k } : {}),
    };
  });

  return { version: root.version, cases };
}

export async function loadGoldenCaseFile(path: string): Promise<GoldenCaseFile> {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    throw new Error(`golden cases file not found: ${path}`);
  }
  return parseGoldenCaseFile(await file.json());
}

export async function runGoldenEval(options: {
  cases: readonly GoldenCase[];
  retrieve: GoldenRetriever;
  mode: "fixture" | "live";
  version?: number;
  /** Max hits requested from retriever (default 5). */
  topK?: number;
}): Promise<GoldenEvalReport> {
  const topK = options.topK ?? Math.max(...DEFAULT_K);
  const caseMetrics: CaseMetrics[] = [];

  for (const testCase of options.cases) {
    const requestedK = testCase.k && testCase.k.length > 0 ? Math.max(...testCase.k, topK) : topK;
    const ranked = await options.retrieve({
      caseId: testCase.id,
      query: testCase.query,
      topK: requestedK,
    });
    caseMetrics.push(computeCaseMetrics(testCase.id, ranked, testCase.relevant, testCase.expectNoAnswer === true));
  }

  const macro: MacroMetrics = aggregateMacroMetrics(caseMetrics);
  return {
    version: options.version ?? 1,
    mode: options.mode,
    generatedAt: new Date().toISOString(),
    cases: caseMetrics,
    macro,
  };
}

/** Adapter used by fixture and live harnesses so evaluation traverses the public retrieval pipeline. */
export function createRetrievalServiceGoldenRetriever(
  service: Pick<RetrievalService, "search">,
  defaults?: { identity?: Parameters<RetrievalService["search"]>[0]["identity"] },
): GoldenRetriever {
  return async ({ query, topK }) => {
    const result = await service.search({
      query,
      topK,
      ...(defaults?.identity !== undefined ? { identity: defaults.identity } : {}),
    });
    return result.items.map((item) => ({
      chunkId: item.chunkId,
      documentId: item.documentId,
      score: item.score,
    }));
  };
}

let liveRetrievalService: Pick<RetrievalService, "search"> | null = null;

/** Live harness installs the real tenant-scoped service from an application container. */
export function installLiveRetrievalServiceForEval(service: Pick<RetrievalService, "search"> | null): void {
  liveRetrievalService = service;
}

export function getLiveRetrievalServiceForEval(): Pick<RetrievalService, "search"> | null {
  return liveRetrievalService;
}

export async function writeGoldenEvalReport(report: GoldenEvalReport, outputDir: string = resolveKbEvalOutputDir()): Promise<string> {
  await mkdir(outputDir, { recursive: true });
  const fileName = `report.${report.mode}.${report.generatedAt.replaceAll(":", "-")}.json`;
  const path = join(outputDir, fileName);
  await Bun.write(path, `${JSON.stringify(report, null, 2)}\n`);

  const latestPath = join(outputDir, `report.${report.mode}.latest.json`);
  await Bun.write(latestPath, `${JSON.stringify(report, null, 2)}\n`);
  return path;
}

/** Best-effort report write — CI hard gate must not fail on `.tmp` I/O (sandbox/readonly). */
export async function tryWriteGoldenEvalReport(
  report: GoldenEvalReport,
  outputDir: string = resolveKbEvalOutputDir(),
): Promise<string | null> {
  try {
    return await writeGoldenEvalReport(report, outputDir);
  } catch (error) {
    console.warn(`[kb-golden-eval] skip report write: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/**
 * Thin in-memory keyword stub for CI fixture mode.
 * Scores chunks by query token / substring overlap — no Docker/Qdrant/RetrievalService.
 */
export interface FixtureCorpusChunk {
  documentId: string;
  chunkId: string;
  text: string;
  keywords?: string[];
}

export function createInMemoryKeywordRetriever(corpus: readonly FixtureCorpusChunk[]): GoldenRetriever {
  return ({ query, topK }) => {
    const normalizedQuery = normalizeText(query);
    const queryTokens = tokenize(normalizedQuery);
    const scored = corpus
      .map((chunk) => {
        const text = normalizeText(chunk.text);
        const keywordBlob = normalizeText((chunk.keywords ?? []).join(" "));
        const haystack = `${text} ${keywordBlob}`.trim();
        let score = 0;

        if (haystack.includes(normalizedQuery) && normalizedQuery.length >= 2) {
          score += 10;
        }
        for (const token of queryTokens) {
          if (token.length < 2) continue;
          if (haystack.includes(token)) score += token.length >= 4 ? 3 : 1;
        }
        // Character bigrams help short Chinese queries without whitespace.
        for (const gram of characterNgrams(normalizedQuery, 2)) {
          if (haystack.includes(gram)) score += 0.5;
        }
        return { documentId: chunk.documentId, chunkId: chunk.chunkId, score };
      })
      .filter((row) => row.score > 0)
      .toSorted((a, b) => b.score - a.score || a.chunkId.localeCompare(b.chunkId));

    return scored.slice(0, topK);
  };
}

function normalizeText(value: string): string {
  return value.normalize("NFKC").toLowerCase().trim().replaceAll(/\s+/gu, " ");
}

function tokenize(value: string): string[] {
  return value
    .split(/[^\p{L}\p{N}_./-]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

function characterNgrams(value: string, n: number): string[] {
  const compact = value.replaceAll(/\s+/gu, "");
  if (compact.length < n) return compact.length > 0 ? [compact] : [];
  const grams: string[] = [];
  for (let index = 0; index <= compact.length - n; index += 1) {
    grams.push(compact.slice(index, index + n));
  }
  return grams;
}
