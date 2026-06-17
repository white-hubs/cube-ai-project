import { ApiOperation, ApiResponse, Controller, GET, Injectable } from '@dangao/bun-server'
import { MockableEndpoint } from '@cube-ai/ai-center/platform/server-mock'
import { currentTenantId, isGlobalAccessEnabled } from '@cube-ai/tenant-context'
import { getExecutionMetricsSnapshot, getExecutionMetricsRecent } from './execution-metrics'

/**
 * 管理面：执行指标快照（需 JWT，路径进程内 `/execution/metrics` → 对外 `/api/execution/metrics`）。
 */
@Injectable()
@Controller('/execution')
export class ExecutionMetricsController {
  /**
   * 查询执行指标汇总快照。
   *
   * @returns 指标汇总对象（吞吐、耗时、成功率等）
   */
  @GET('/metrics')
  @ApiOperation({
    summary: '执行指标快照',
    description: '返回当前项目（或全局）的执行指标汇总数据。',
    operationId: 'getExecutionMetricsSummary',
  })
  @ApiResponse({
    status: 200,
    description: '执行指标快照',
    schema: {
      type: 'object',
      additionalProperties: true,
      description: '指标字段由运行时统计模块提供',
    } as Record<string, unknown>,
  })
  @MockableEndpoint('metrics.summary')
  summary() {
    const pid = isGlobalAccessEnabled() ? null : currentTenantId()
    return getExecutionMetricsSnapshot(pid)
  }

  /**
   * 查询近期执行记录指标。
   *
   * @returns 近期执行样本与统计明细
   */
  @GET('/metrics/recent')
  @ApiOperation({
    summary: '近期执行指标',
    description: '返回近期执行记录对应的指标明细。',
    operationId: 'getExecutionMetricsRecent',
  })
  @ApiResponse({
    status: 200,
    description: '近期执行指标',
    schema: {
      type: 'object',
      additionalProperties: true,
      description: '近期指标字段由运行时统计模块提供',
    } as Record<string, unknown>,
  })
  @MockableEndpoint('metrics.recent')
  recent() {
    const pid = isGlobalAccessEnabled() ? null : currentTenantId()
    return getExecutionMetricsRecent(pid)
  }
}
