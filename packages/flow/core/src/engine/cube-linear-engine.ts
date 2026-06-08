import { HttpException } from '@dangao/bun-server'
import type { LlmProviderPort } from '@cube-ai/contracts'
import type { CubeFlowGraph, CubeFlowNode } from '../contracts/cube-flow'
import type { NormalizedRunBody } from '../contracts/cube-run'
import { encodeCubeSseEvent } from '../langflow/build-event-mapper'
import {
  isChatInputLfKey,
  isLlmLfKey,
  lfKeyFromCubeType,
  resolveLinearExecutionChain,
} from './linear-chain'
import { cubeLlmChatStream, cubeLlmChatSync, resolveCubeEngineLlmConfig } from './cube-engine-llm'

export type CubeEngineContext = {
  llm: LlmProviderPort
  tenant: number
  signal?: AbortSignal
}

function resolveUserMessageForChain(chain: CubeFlowNode[], norm: NormalizedRunBody): string {
  if (chain.length === 0) return norm.input ?? ''
  /** 最后一个为 LLM，其前可有 ChatInput */
  let msg = norm.input ?? ''
  for (let i = 0; i < chain.length - 1; i++) {
    const node = chain[i]!
    const k = lfKeyFromCubeType(node.cubeType)
    if (k === 'note') continue
    if (isChatInputLfKey(k)) {
      msg =
        typeof norm.input === 'string' && norm.input.trim() !== ''
          ? norm.input
          : String(node.config['input_value'] ?? '')
      continue
    }
    throw new HttpException(422, `Cube engine MVP only allows ChatInput/note before LLM, got: ${k}`, {
      code: 'CUBE_ENGINE_UNSUPPORTED_NODE',
    })
  }
  return msg
}

function assertLlmConfigured(llmCfg: ReturnType<typeof resolveCubeEngineLlmConfig>): void {
  if (!llmCfg.legacyApiKey && !llmCfg.modelCode) {
    throw new HttpException(503, 'LLM modelRef or api_key missing in node config', {
      code: 'CUBE_ENGINE_LLM_CONFIG',
    })
  }
}

export async function runCubeLinearEngineSync(
  graph: CubeFlowGraph,
  norm: NormalizedRunBody,
  ctx: CubeEngineContext,
): Promise<{ text: string; totalTokens?: number; execution_backend: 'cube-engine' }> {
  const chain = resolveLinearExecutionChain(graph)
  const last = chain[chain.length - 1]
  if (!last || !isLlmLfKey(lfKeyFromCubeType(last.cubeType))) {
    throw new HttpException(422, 'Cube engine MVP requires terminal LLM node', {
      code: 'CUBE_ENGINE_UNSUPPORTED_GRAPH',
    })
  }
  const userMsg = resolveUserMessageForChain(chain, norm)
  const llmCfg = resolveCubeEngineLlmConfig(last.config, ctx.tenant)
  assertLlmConfigured(llmCfg)
  const r = await cubeLlmChatSync(ctx.llm, userMsg, llmCfg, ctx.signal)
  return { text: r.text, totalTokens: r.totalTokens, execution_backend: 'cube-engine' }
}

/**
 * Cube 自研引擎 MVP（阶段 2）：线性链 `ChatInput* → LLM`，经 LlmProviderPort 流式输出。
 * 不调用 Langflow 执行 API。
 */
export function createCubeLinearEngineSseStream(
  graph: CubeFlowGraph,
  norm: NormalizedRunBody,
  flowPk: string,
  ctx: CubeEngineContext,
  mergeRequestExt?: Record<string, unknown>,
): ReadableStream<Uint8Array> {
  const chain = resolveLinearExecutionChain(graph)
  const last = chain[chain.length - 1]
  if (!last || !isLlmLfKey(lfKeyFromCubeType(last.cubeType))) {
    throw new HttpException(422, 'Cube engine MVP requires terminal LLM node (AIMLModel/OpenAIModel/…)', {
      code: 'CUBE_ENGINE_UNSUPPORTED_GRAPH',
    })
  }

  const userMsg = resolveUserMessageForChain(chain, norm)
  const llmNode = last
  const llmCfg = resolveCubeEngineLlmConfig(llmNode.config, ctx.tenant)

  return new ReadableStream({
    async start(controller) {
      try {
        assertLlmConfigured(llmCfg)
        controller.enqueue(
          encodeCubeSseEvent(
            {
              type: 'node_start',
              payload: {
                vertices: chain.map((n) => n.lfNodeId),
                phase: 'cube-linear',
                flow_id: flowPk,
              },
            },
            mergeRequestExt,
          ),
        )

        const usage = await cubeLlmChatStream(
          ctx.llm,
          userMsg,
          llmCfg,
          (delta) => {
            controller.enqueue(encodeCubeSseEvent({ type: 'token', payload: { text: delta } }, mergeRequestExt))
          },
          ctx.signal,
        )

        controller.enqueue(
          encodeCubeSseEvent(
            {
              type: 'node_end',
              payload: {
                vertex_id: llmNode.lfNodeId,
                terminal: true,
                usage_hint: { total_tokens: usage.totalTokens },
              },
            },
            mergeRequestExt,
          ),
        )
        controller.enqueue(
          encodeCubeSseEvent(
            {
              type: 'end',
              payload: {
                total_tokens: usage.totalTokens,
                execution_backend: 'cube-engine',
              },
            },
            mergeRequestExt,
          ),
        )
      } catch (e) {
        const msg = e instanceof HttpException ? e.message : e instanceof Error ? e.message : String(e)
        controller.enqueue(
          encodeCubeSseEvent({ type: 'error', payload: { message: msg } }, mergeRequestExt),
        )
        controller.enqueue(encodeCubeSseEvent({ type: 'end', payload: {} }, mergeRequestExt))
      } finally {
        controller.close()
      }
    },
  })
}
