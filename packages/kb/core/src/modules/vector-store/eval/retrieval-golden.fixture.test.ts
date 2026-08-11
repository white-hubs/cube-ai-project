import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import { makeMockAppConfig } from "../../../test-helpers/mock-app-config";
import { RetrievalService } from "../services/retrieval.service";
import { assertMeetsBaseline } from "./metrics";
import type { FixtureCorpusChunk } from "./run-golden-eval";
import {
  createInMemoryKeywordRetriever,
  createRetrievalServiceGoldenRetriever,
  loadGoldenCaseFile,
  resolveGoldenCasesPath,
  resolveKbEvalOutputDir,
  runGoldenEval,
  tryWriteGoldenEvalReport,
} from "./run-golden-eval";

/**
 * Fixture baselines (W1.4-H5). Filled from first stable keyword-stub run on cases.v1.json.
 * Update in the same PR when intentional retrieval/stub changes lower scores; explain why.
 */
export const BASELINE_HIT_AT_3 = 1;
export const BASELINE_MRR = 1;
/** CI regression floor only; E1 fixture does not prove live quality reaches 80. */
export const BASELINE_NDCG_AT_5 = 0.8;

/** Package root: packages/kb/core (eval → vector-store → modules → src → kb/core). */
const PACKAGE_ROOT = join(import.meta.dir, "../../../../");

/**
 * Synthetic corpus aligned with cases.v1.json.
 * Keyword stub ranks these offline — no Docker / Qdrant / RetrievalService.
 */
const FIXTURE_CORPUS: FixtureCorpusChunk[] = [
  {
    documentId: "doc-pdf-spec",
    chunkId: "pdf-clause-2-1",
    text: "5.2 规范性引用文件要求：本规范引用的国家标准与行业标准应采用最新有效版本。",
    keywords: ["规范性引用", "引用文件"],
  },
  {
    documentId: "doc-pdf-spec",
    chunkId: "pdf-clause-2-2",
    text: "引用文件清单仅作索引，具体条款以被引用标准正文为准。",
    keywords: ["引用文件"],
  },
  {
    documentId: "doc-pdf-spec",
    chunkId: "pdf-clause-5-1",
    text: "电气安装总则：设备应可靠接地并标识警示牌。",
    keywords: ["电气"],
  },
  {
    documentId: "doc-pdf-spec",
    chunkId: "pdf-clause-5-3",
    text: "电气安全防护距离应满足带电体与作业面最小间隙要求，禁止跨越警示线作业。",
    keywords: ["电气安全", "防护距离"],
  },
  {
    documentId: "doc-pdf-spec",
    chunkId: "pdf-noise-intro",
    text: "本文件规定了合成样例产品的一般技术条件，不涉及真实租户数据。",
  },
  {
    documentId: "doc-pdf-accept",
    chunkId: "pdf-accept-7-1",
    text: "验收流程概述：提交样机、执行检测、出具报告。",
    keywords: ["验收"],
  },
  {
    documentId: "doc-pdf-accept",
    chunkId: "pdf-accept-7-2",
    text: "出厂验收合格判据：关键性能指标全部达标且无致命缺陷。",
    keywords: ["出厂验收", "合格判据"],
  },
  {
    documentId: "doc-assets",
    chunkId: "asset-table-header",
    text: "工作表 Assets\n列: 设备编码 | 设备名称 | 所属机房",
    keywords: ["设备编码", "设备名称", "所属机房"],
  },
  {
    documentId: "doc-assets",
    chunkId: "asset-row-a102",
    text: "第1行: 设备编码=A-102; 设备名称=研发中心边缘网关; 所属机房=IDC-A",
    keywords: ["A-102", "设备编码"],
  },
  {
    documentId: "doc-assets",
    chunkId: "asset-row-cbrs",
    text: "第2行: 设备编码=B-220; 设备名称=研发中心3号265CBRS; 所属机房=IDC-B",
    keywords: ["研发中心3号265CBRS", "265CBRS"],
  },
  {
    documentId: "doc-parts",
    chunkId: "part-pn-88c",
    text: "备件: 料号 PN-88C-4401，名称 电源模块，库存 12",
    keywords: ["PN-88C-4401"],
  },
  {
    documentId: "doc-parts",
    chunkId: "part-other",
    text: "备件: 料号 PN-11A-1000，名称 风扇组件",
    keywords: ["PN-11A-1000"],
  },
  {
    documentId: "doc-handbook",
    chunkId: "nav-ch3-deploy",
    text: "第3章 部署架构\n部署架构概览与组件拓扑。",
    keywords: ["第3章", "部署架构"],
  },
  {
    documentId: "doc-handbook",
    chunkId: "nav-ch3-overview",
    text: "第3章概述：说明多区域部署的基本原则。",
    keywords: ["第3章"],
  },
  {
    documentId: "doc-handbook",
    chunkId: "nav-appendix-a",
    text: "附录A 术语表\n列出本文使用的缩略语与定义。",
    keywords: ["附录A", "术语表"],
  },
  {
    documentId: "doc-handbook",
    chunkId: "nav-system-overview",
    text: "第1章 系统概述\n介绍系统目标、能力边界与核心组成。",
    keywords: ["第1章", "系统概述"],
  },
  {
    documentId: "doc-handbook",
    chunkId: "nav-toc-overview",
    text: "目录\n1 系统概述\n2 架构\n3 部署架构",
    keywords: ["目录", "系统概述"],
  },
  {
    documentId: "doc-handbook",
    chunkId: "nav-noise-ops",
    text: "运维值班要求与联系方式（样例）。",
  },
  {
    documentId: "doc-sla",
    chunkId: "sla-table-availability",
    text: "表1 SLA 指标\n可用性 SLA 目标值: 99.95%",
    keywords: ["可用性", "SLA", "目标值"],
  },
  {
    documentId: "doc-sla",
    chunkId: "sla-table-latency",
    text: "表2 延迟指标\nP99 延迟目标值: 200ms",
    keywords: ["延迟", "目标值"],
  },
  {
    documentId: "doc-solution",
    chunkId: "sem-false-alarm",
    text: "系统通过规则引擎与多模型协同降低误报并减少人工复核成本。",
    keywords: ["降低误报", "人工复核"],
  },
  {
    documentId: "doc-solution",
    chunkId: "sem-overview",
    text: "系统整体方案介绍与能力边界说明。",
    keywords: ["方案介绍"],
  },
];

function createFixtureRetrievalService(): RetrievalService {
  const keyword = createInMemoryKeywordRetriever(FIXTURE_CORPUS);
  const embeddingProvider = {
    embed: async () => [{ dense: [1], sparse: null }],
  };
  const qdrant = { search: async () => [] };
  const chunks = {
    findByDocumentIdAndSectionId: async () => [],
    searchLexicalChunks: async ({ query, topK }: { query: string; topK: number }) => {
      const hits = await keyword({ caseId: "fixture", query, topK });
      return hits.flatMap((hit) => {
        const source = FIXTURE_CORPUS.find((chunk) => chunk.documentId === hit.documentId && chunk.chunkId === hit.chunkId);
        if (!source) return [];
        return [
          {
            caption_text: null,
            chunk_id: source.chunkId,
            chunk_index: 0,
            chunk_type: "paragraph",
            cue_index: null,
            document_id: source.documentId,
            embedding_text: source.text,
            end_time: null,
            file_name: `${source.documentId}.txt`,
            headers_text: null,
            heading_path: "[]",
            keywords_text: JSON.stringify(source.keywords ?? []),
            lexical_score: hit.score ?? 1,
            order_in_section: 0,
            page_no: null,
            picture_description: null,
            property_namespace: null,
            qdrant_point_id: source.chunkId,
            row_end: null,
            row_start: null,
            section_id: source.chunkId,
            sheet_name: null,
            source_type: "fixture",
            start_time: null,
            table_id: null,
            text_content: source.text,
          },
        ];
      });
    },
  };
  return new RetrievalService(
    makeMockAppConfig({
      retrievalDefaultSimilarityThreshold: 0,
      retrievalModelRerankEnabled: false,
      retrievalScoreThreshold: 0,
    }),
    embeddingProvider as never,
    qdrant as never,
    {} as never,
    chunks as never,
    undefined,
    undefined,
  );
}

describe("retrieval golden fixture gate (W1.4)", () => {
  test("cases.v1.json has ≥10 cases covering semantic/entity/navigation/table", async () => {
    const file = await loadGoldenCaseFile(resolveGoldenCasesPath(PACKAGE_ROOT));
    expect(file.version).toBe(1);
    expect(file.cases.length).toBeGreaterThanOrEqual(10);

    const profiles = new Set(file.cases.map((item) => item.profileHint));
    for (const required of ["semantic", "entity", "navigation", "table"] as const) {
      expect(profiles.has(required)).toBe(true);
    }

    const pdfLike = file.cases.filter((item) => item.id.startsWith("clause-"));
    expect(pdfLike.length).toBeGreaterThanOrEqual(3);
  });

  test("fixture eval meets BASELINE hit@3 and MRR (CI gate)", async () => {
    const file = await loadGoldenCaseFile(resolveGoldenCasesPath(PACKAGE_ROOT));
    const retrieve = createRetrievalServiceGoldenRetriever(createFixtureRetrievalService());
    const report = await runGoldenEval({
      cases: file.cases,
      retrieve,
      mode: "fixture",
      version: file.version,
    });

    expect(report.macro.caseCount).toBe(file.cases.length);
    assertMeetsBaseline(report.macro, {
      hitAt3: BASELINE_HIT_AT_3,
      mrr: BASELINE_MRR,
      ndcgAt5: BASELINE_NDCG_AT_5,
      noAnswerFalseRecallRate: 0,
    });
    // Report I/O is best-effort; baseline assertion above is the CI hard gate.
    await tryWriteGoldenEvalReport(report, resolveKbEvalOutputDir());

    // Keep recorded numbers visible in failures / local runs.
    expect(report.macro.hitRateAt1).toBeGreaterThanOrEqual(0);
    expect(report.macro.ndcgAt5).toBeGreaterThanOrEqual(0);
    expect(report.macro.noAnswerFalseRecallRate).toBe(0);
  });

  /**
   * W2.2-H3 / G0-6: model rerank defaults off so fixture CI baseline is unchanged.
   * Stub that preserves keyword order must not lower macro vs identity (off) path.
   */
  test("W2.2-H3: stub identity-preserving rerank does not lower fixture macro vs off", async () => {
    const file = await loadGoldenCaseFile(resolveGoldenCasesPath(PACKAGE_ROOT));
    const baseRetrieve = createRetrievalServiceGoldenRetriever(createFixtureRetrievalService());
    const offReport = await runGoldenEval({
      cases: file.cases,
      retrieve: baseRetrieve,
      mode: "fixture",
      version: file.version,
    });

    const stubPreserveRetrieve: typeof baseRetrieve = async (input) => {
      const ranked = await baseRetrieve(input);
      // Identity stub: same order/scores as keyword path (model off equivalent).
      return ranked.map((hit, index) => ({ ...hit, score: ranked.length - index }));
    };
    const stubReport = await runGoldenEval({
      cases: file.cases,
      retrieve: stubPreserveRetrieve,
      mode: "fixture",
      version: file.version,
    });

    expect(stubReport.macro.hitRateAt3).toBeGreaterThanOrEqual(offReport.macro.hitRateAt3);
    expect(stubReport.macro.mrr).toBeGreaterThanOrEqual(offReport.macro.mrr);
    assertMeetsBaseline(offReport.macro, { hitAt3: BASELINE_HIT_AT_3, mrr: BASELINE_MRR });
  });
});
