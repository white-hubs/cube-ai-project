import { describe, expect, test } from 'bun:test'
import { CUBE_FLOW_SCHEMA_VERSION, type CubeFlowGraph } from '../contracts/cube-flow'
import { applyInputFilesToChatInputTweaks, mapTweaksNodeIdsForLangflow } from './flow-langflow-sync.service'
import type { NormalizedRunBody } from '../contracts/cube-run'

describe('mapTweaksNodeIdsForLangflow', () => {
  const graph: CubeFlowGraph = {
    schemaVersion: CUBE_FLOW_SCHEMA_VERSION,
    nodes: [
      {
        id: 'cube-chat-1',
        lfNodeId: 'ChatInput-a1b2c3',
        cubeType: 'cube.lf.ChatInput',
        x: 0,
        y: 0,
        width: 320,
        height: 180,
        config: {},
      },
    ],
    edges: [],
  }

  test('maps Cube node id tweak keys to Langflow node ids', () => {
    expect(
      mapTweaksNodeIdsForLangflow(
        {
          'cube-chat-1': {
            files: ['/tmp/uploaded.txt'],
          },
        },
        graph,
      ),
    ).toEqual({
      'ChatInput-a1b2c3': {
        files: ['/tmp/uploaded.txt'],
      },
    })
  })

  test('keeps Langflow node id tweak keys compatible', () => {
    expect(
      mapTweaksNodeIdsForLangflow(
        {
          'ChatInput-a1b2c3': {
            input_value: 'hello',
          },
        },
        graph,
      ),
    ).toEqual({
      'ChatInput-a1b2c3': {
        input_value: 'hello',
      },
    })
  })

  test('injects structured input files into ChatInput files tweak before Langflow mapping', () => {
    const body: NormalizedRunBody = {
      input: 'describe image',
      input_files: [
        { file_path: 'flow-1/2026-05-22_image.png', mime: 'image/png' },
        { path: 'flow-1/2026-05-22_second.jpg' },
      ],
      user_context: {},
      runtime_config: {},
    }

    const patched = applyInputFilesToChatInputTweaks(body, graph)

    expect(patched.tweaks).toEqual({
      'cube-chat-1': {
        files: ['flow-1/2026-05-22_image.png', 'flow-1/2026-05-22_second.jpg'],
      },
    })
    expect(mapTweaksNodeIdsForLangflow(patched.tweaks, graph)).toEqual({
      'ChatInput-a1b2c3': {
        files: ['flow-1/2026-05-22_image.png', 'flow-1/2026-05-22_second.jpg'],
      },
    })
  })

  test('does not overwrite explicit ChatInput files tweak', () => {
    const body: NormalizedRunBody = {
      input: 'describe image',
      input_files: [{ file_path: 'flow-1/new.png' }],
      tweaks: {
        'cube-chat-1': {
          files: ['flow-1/explicit.png'],
        },
      },
      user_context: {},
      runtime_config: {},
    }

    expect(applyInputFilesToChatInputTweaks(body, graph).tweaks).toEqual({
      'cube-chat-1': {
        files: ['flow-1/explicit.png'],
      },
    })
  })
})
