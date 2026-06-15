/**
 * DescriptorOpsHandler — 管理 ops 工具集的**进程内面**（ADR-0027 §7）。
 *
 * 单个参数化 handler（kind = `descriptorOps`）覆盖全部管理 op：ToolService 经 execute ref
 * `builtin:platform.descriptor.<op>` 适配出 `{ op, args }`，本 handler 据 op 派发到
 * {@link runDescriptorOp}（与 MCP 门面共用同一核）。
 *
 * 租户隔离自动：tenant 取自 `ctx.auth.tenant`，actor 取自 `ctx.auth.user`，
 * **绝不**接受工具入参里的 tenant（ADR-0012 addendum）。consent 由 Tool 编排按
 * descriptor 声明把关（本 handler 不做 consent，ADR-0027 §9）。
 */
import { Injectable } from '@dangao/bun-server';
import { AgenticEngineError } from '../../../infra/errors/agentic-error';
import { DescriptorManagementService } from '../../descriptor/descriptor-management.service';
import type { ToolHandlerCtx } from '../tool-context';
import type { ToolHandler } from './base-handler';
import { isDescriptorOp, runDescriptorOp, type DescriptorOp } from './descriptor-ops';

export interface DescriptorOpsHandlerInput {
  op: DescriptorOp;
  args: Record<string, unknown>;
}

@Injectable()
export class DescriptorOpsHandler
  implements ToolHandler<DescriptorOpsHandlerInput, unknown>
{
  readonly kind = 'descriptorOps' as unknown as ToolHandler['kind'];

  constructor(private readonly svc: DescriptorManagementService) {}

  async invoke(input: DescriptorOpsHandlerInput, ctx: ToolHandlerCtx): Promise<unknown> {
    const op = input?.op;
    if (!op || !isDescriptorOp(op)) {
      throw AgenticEngineError.fromCode(
        'INVALID_ARGUMENT_SCHEMA_VIOLATION',
        `Unknown descriptor management op: ${String(op)}`,
      );
    }
    const actor = ctx.auth.user?.userId;
    return runDescriptorOp(this.svc, op, ctx.auth.tenant, input.args ?? {}, actor);
  }
}
