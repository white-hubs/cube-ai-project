/**
 * OTel NodeSDK 预初始化。
 *
 * 必须以副作用 import 的形式在 main.ts **第一行**执行：
 *   import './infra/observability/otel-setup';
 *
 * 设计参考：docs/technical-design/phase-1/P1-10-observability.md §3.1
 * M1 权威：docs/detailed-design/11-observability/README.md §3.3
 *
 * R18 说明：本文件 import OTel SDK 类型（typecheck 需要），但 sdk.start() 不建立真实 socket。
 * 真实 Collector 连接由 user 配置 OTEL_EXPORTER_OTLP_ENDPOINT 后生效。
 */

import { NodeSDK } from '@opentelemetry/sdk-node';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { createBootstrapLogger } from './logger.factory';

// OTel Semantic Conventions 字符串常量（避免额外包依赖；来自 OTel Semantic Conventions 1.x）
const SEMATTRS_SERVICE_NAME = 'service.name';
const SEMATTRS_SERVICE_VERSION = 'service.version';
const SEMATTRS_DEPLOYMENT_ENVIRONMENT = 'deployment.environment';
const SEMATTRS_SERVICE_INSTANCE_ID = 'service.instance.id';

/** 幂等保护标志 */
let _sdkStarted = false;

const bootLog = createBootstrapLogger(
  'agentic.engine.bootstrap.otel',
  'agentic.engine.adapter.observability',
);

export function startOtelSdk(): void {
  if (_sdkStarted) {
    bootLog.warn('OTel SDK already started, skip');
    return;
  }

  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? '';

  const resource = resourceFromAttributes({
    [SEMATTRS_SERVICE_NAME]: 'cube-agentic-engine',
    [SEMATTRS_SERVICE_VERSION]: process.env.AGENTIC_ENGINE_VERSION ?? '0.0.0',
    [SEMATTRS_DEPLOYMENT_ENVIRONMENT]: (
      process.env.AGENTIC_ENGINE_ENV ?? 'DEV'
    ).toUpperCase(),
    [SEMATTRS_SERVICE_INSTANCE_ID]:
      process.env.HOSTNAME ?? process.env.POD_NAME ?? 'local',
    'engine.build_sha': process.env.BUILD_SHA ?? 'unknown',
  });

  if (!endpoint) {
    // NoOp 模式：不建立连接，OTel API 进入 NoOp provider
    bootLog.warn(
      { gracefulDegrade: true },
      'OTEL_EXPORTER_OTLP_ENDPOINT not set, OTel running in NoOp mode',
    );
    _sdkStarted = true;
    return;
  }

  const sdk = new NodeSDK({
    resource,
    traceExporter: new OTLPTraceExporter({
      url: `${endpoint}/v1/traces`,
    }),
    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({ url: `${endpoint}/v1/metrics` }),
      exportIntervalMillis: Number(process.env.OTEL_METRIC_EXPORT_INTERVAL_MS ?? 10_000),
    }),
    logRecordProcessor: new BatchLogRecordProcessor(
      new OTLPLogExporter({ url: `${endpoint}/v1/logs` }),
    ),
    instrumentations: [
      getNodeAutoInstrumentations({
        // fs 埋点噪音太大，禁用；见 11-observability/README.md §3.3
        '@opentelemetry/instrumentation-fs': { enabled: false },
      }),
    ],
  });

  sdk.start();
  _sdkStarted = true;
}

/** 仅测试用：重置 SDK 状态 */
export function _resetOtelSdkForTest(): void {
  _sdkStarted = false;
}

/** 副作用：模块加载即启动 OTel SDK（main.ts 首行 import 时执行） */
startOtelSdk();
