/**
 * ShellHandler — Bun.spawn 执行 shell；黑名单 + SafetyModule 基线校验。
 *
 * 权威来源：docs/detailed-design/07-tools/builtin-catalog.md
 */
import { Inject, Injectable } from '@dangao/bun-server';
import type { ExecutionContext, InputEnvelope, SafetyModule } from '@tachu/core';
import { AgenticEngineError } from '../../../infra/errors/agentic-error';
import type { ToolHandlerCtx } from '../tool-context';
import type { ToolHandler } from './base-handler';
import { AGENTIC_SAFETY_MODULE_TOKEN } from '@cube-ai/agent-engine/adapters/tokens';

export interface ShellHandlerInput {
  command:  string;
  args?:    string[];
  cwd?:     string;
  env?:     Record<string, string>;
  timeout?: number;
}

export interface ShellHandlerOutput {
  exitCode: number;
  stdout:   string;
  stderr:   string;
}

async function readAllText(
  stream: number | ReadableStream<Uint8Array> | undefined,
): Promise<string> {
  if (!stream || typeof stream === 'number') return '';
  const reader = stream.getReader();
  const dec = new TextDecoder();
  let out = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    out += dec.decode(value, { stream: true });
  }
  return out;
}

/** 基础黑名单（与 P1-12 扩展策略互补）— dangerous binaries */
const BLACKLISTED_COMMANDS = ['rm', 'rmdir', 'dd', 'mkfs', 'shutdown', 'reboot', 'halt'];

@Injectable()
export class ShellHandler implements ToolHandler<ShellHandlerInput, ShellHandlerOutput> {
  readonly kind = 'shell' as const;

  constructor(
    @Inject(AGENTIC_SAFETY_MODULE_TOKEN) private readonly safety: SafetyModule,
  ) {}

  async invoke(input: ShellHandlerInput, ctx: ToolHandlerCtx): Promise<ShellHandlerOutput> {
    const baseCommand = input.command.trim().split(/\s+/)[0] ?? '';
    if (BLACKLISTED_COMMANDS.includes(baseCommand)) {
      throw AgenticEngineError.fromCode(
        'PERMISSION_DENIED_SHELL_BLACKLISTED_COMMAND',
        `Command '${baseCommand}' is blacklisted.`,
      );
    }

    const execLine = [input.command, ...(input.args ?? [])].join(' ');
    const envelope: InputEnvelope = {
      content: execLine,
      metadata: { source: 'tool.shell' },
    };
    const execCtx: ExecutionContext = {
      correlation: {
        traceId:   ctx.traceId,
        requestId: ctx.traceId,
        sessionId: ctx.session.id,
        turnId:    ctx.session.turnId,
      },
      principal: {
        tenant: ctx.auth.tenant,
        ...(ctx.auth.user?.userId ? { userId: ctx.auth.user.userId } : {}),
      },
      subject: {
        tenant: String(ctx.auth.tenant),
        ...(ctx.auth.user?.userId ? { userId: ctx.auth.user.userId } : {}),
      },
      budget: {},
      scopes: ctx.auth.user?.scopes ?? [],
      abortSignal: ctx.signal,
    };

    const baseline = await this.safety.checkBaseline(envelope, execCtx);
    if (!baseline.passed) {
      const first = baseline.violations.find((v) => v.severity === 'error');
      throw AgenticEngineError.fromCode(
        'INVALID_ARGUMENT_SAFETY_REJECTED',
        first?.message ?? 'Shell command rejected by safety baseline',
        { violations: baseline.violations },
      );
    }

    const timeoutMs = input.timeout ?? 60_000;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const onCtxAbort = () => ctrl.abort();
    ctx.signal.addEventListener('abort', onCtxAbort);

    const argv = [input.command, ...(input.args ?? [])];
    let proc: ReturnType<typeof Bun.spawn>;

    try {
      proc = Bun.spawn(argv, {
        cwd:         input.cwd,
        env:         { ...process.env, ...input.env },
        stdout:      'pipe',
        stderr:      'pipe',
        stdin:       'ignore',
        signal:      ctrl.signal,
      });
    } catch (e) {
      clearTimeout(timer);
      ctx.signal.removeEventListener('abort', onCtxAbort);
      throw AgenticEngineError.fromCode(
        'INTERNAL_SPAWN_FAILED',
        `ShellHandler: spawn failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    try {
      const [stdout, stderr] = await Promise.all([
        readAllText(proc.stdout),
        readAllText(proc.stderr),
      ]);
      const exitCode = await proc.exited;
      clearTimeout(timer);
      ctx.signal.removeEventListener('abort', onCtxAbort);
      return { exitCode, stdout, stderr };
    } catch (e) {
      clearTimeout(timer);
      ctx.signal.removeEventListener('abort', onCtxAbort);
      try {
        proc.kill();
      } catch {
        /* ignore */
      }
      if (e instanceof Error && e.name === 'AbortError') {
        throw AgenticEngineError.fromCode(
          'UPSTREAM_TOOL_SHELL_TIMEOUT',
          `ShellHandler: exceeded ${timeoutMs}ms or parent aborted`,
        );
      }
      throw AgenticEngineError.fromCode(
        'INTERNAL_SPAWN_FAILED',
        `ShellHandler: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
}
