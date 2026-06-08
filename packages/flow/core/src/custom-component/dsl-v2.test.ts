import { describe, expect, test } from 'bun:test'
import { CUBE_CUSTOM_COMPONENT_DSL_KEY } from '../shared-imports/cube-component-schema'
import { compileParsedDslV2, listPipForDslV2 } from './compile-v2'
import { buildCubeComponentSchemaFromDslPayload } from './dsl-to-cube-schema'
import type { CubeCustomComponentDslV2 } from './dsl-v2.schema'
import { safeParseCubeCustomComponentDslV2 } from './dsl-v2.schema'
import { emptyCubeFlowGraph } from '../contracts/cube-flow'
import { prepareCubeGraphLangflowExport } from './prepare-graph-for-lf'
import { validateCubeCustomComponentGraph } from './validate-graph'
import { roughPythonBraceBalance } from './static-check'

function minimalV2(overrides: Partial<CubeCustomComponentDslV2> = {}): CubeCustomComponentDslV2 {
  const base: CubeCustomComponentDslV2 = {
    dslVersion: 2,
    extends: 'component',
    metadata: {
      name: 'V2Demo',
      display_name: 'V2 Demo',
      description: 'test',
      wrap_build_in_try: false,
    },
    inputs: [
      {
        kind: 'message_text',
        name: 'input_value',
        display_name: 'Input',
        default: 'x',
        tool_mode: true,
      },
    ],
    workflow: { blocks: [] },
    ...overrides,
  }
  return base
}

describe('DSL v2 / schema', () => {
  test('safeParse accepts minimal v2', () => {
    const r = safeParseCubeCustomComponentDslV2(minimalV2())
    expect(r.success).toBe(true)
  })

  test('condition and nested blocks parse', () => {
    const dsl = minimalV2({
      workflow: {
        blocks: [
          {
            type: 'if',
            condition: { kind: 'non_empty', field: 'input_value' },
            then: [
              {
                type: 'op',
                action: 'assign',
                params: { expr: '"ok"' },
                output_as: 'flag',
              },
            ],
            else: [
              {
                type: 'op',
                action: 'assign',
                params: { expr: '"no"' },
                output_as: 'flag',
              },
            ],
          },
        ],
      },
    })
    const r = safeParseCubeCustomComponentDslV2(dsl)
    expect(r.success).toBe(true)
  })
})

describe('DSL v2 / compile', () => {
  test('empty workflow falls back to first input', () => {
    const py = compileParsedDslV2(minimalV2())
    expect(py).toContain('class V2Demo(Component):')
    expect(py).toContain('self.input_value')
    expect(roughPythonBraceBalance(py).ok).toBe(true)
  })

  test('rejects both output and outputs', () => {
    const dsl = minimalV2({
      output: { kind: 'data', method: 'build_output', name: 'output' },
      outputs: [{ kind: 'data', method: 'x', name: 'a' }],
    })
    const r = safeParseCubeCustomComponentDslV2(dsl)
    expect(r.success).toBe(false)
  })

  test('output kind language_model emits LanguageModel and schema types', () => {
    const dsl = minimalV2({
      output: {
        kind: 'language_model',
        name: 'model_output',
        method: 'build_model',
        display_name: 'Model',
      },
    })
    const py = compileParsedDslV2(dsl)
    expect(py).toContain('from lfx.field_typing import LanguageModel')
    expect(py).toContain('def build_model(self) -> LanguageModel:')
    expect(py).toContain('return _lm')
    expect(buildCubeComponentSchemaFromDslPayload(dsl).outputs[0]!.types).toEqual(['LanguageModel'])
    expect(roughPythonBraceBalance(py).ok).toBe(true)
  })

  test('outputs[] pairs LanguageModel + Message with cached workflow', () => {
    const dsl = minimalV2({
      outputs: [
        {
          kind: 'language_model',
          name: 'model_output',
          method: 'build_model',
          display_name: 'Model',
          value_from: 'input_value',
        },
        {
          kind: 'message',
          name: 'text_output',
          method: 'build_text',
          display_name: 'Text',
          value_from: 'input_value',
        },
      ],
    })
    const py = compileParsedDslV2(dsl)
    expect(py).toContain('def _cube_run_workflow_once(self)')
    expect(py).toContain('self._cube_o0')
    expect(py).toContain('self._cube_o1')
    expect(py).toContain('def build_model(self) -> LanguageModel:')
    expect(py).toContain('def build_text(self) -> Message:')
    expect(py).toContain(
      'self._cube_o1 = _cube_o1_value if isinstance(_cube_o1_value, Message) else Message(text=str(_cube_o1_value) if _cube_o1_value is not None else "", sender="Machine", sender_name="AI")',
    )
    expect(py).toContain('if getattr(self._cube_o1, "text", None) is None:')
    expect(py).toContain('if not getattr(self._cube_o1, "sender", None):')
    expect(py).toContain('if not getattr(self._cube_o1, "sender_name", None):')
    const sch = buildCubeComponentSchemaFromDslPayload(dsl)
    expect(sch.outputs.map((o) => o.types)).toEqual([['LanguageModel'], ['Message']])
    expect(roughPythonBraceBalance(py).ok).toBe(true)
  })

  test('output kind message wraps plain text and Cube schema types Message', () => {
    const dsl = minimalV2({
      output: {
        kind: 'message',
        name: 'output',
        method: 'build_output',
        display_name: 'Output',
      },
    })
    const py = compileParsedDslV2(dsl)
    expect(py).toContain('from lfx.schema.message import Message')
    expect(py).not.toContain('from lfx.schema.data import Data')
    expect(py).toContain('def build_output(self) -> Message:')
    expect(py).toContain(
      'msg = _cube_message_value if isinstance(_cube_message_value, Message) else Message(text=str(_cube_message_value) if _cube_message_value is not None else "", sender="Machine", sender_name="AI")',
    )
    expect(py).toContain('if getattr(msg, "text", None) is None:')
    expect(py).toContain('if not getattr(msg, "sender", None):')
    expect(py).toContain('if not getattr(msg, "sender_name", None):')
    expect(py).toContain('return msg')
    expect(buildCubeComponentSchemaFromDslPayload(dsl).outputs[0]!.types).toEqual(['Message'])
    expect(roughPythonBraceBalance(py).ok).toBe(true)
  })

  test('message_merge op preserves Message inputs for multimodal forwarding', () => {
    const dsl = minimalV2({
      inputs: [
        {
          kind: 'message_text',
          name: 'text',
          display_name: 'Text',
          default: '',
          tool_mode: true,
        },
        {
          kind: 'handle',
          name: 'original_message',
          display_name: 'Original Message',
          input_types: ['Message'],
          required: true,
        },
      ],
      workflow: {
        blocks: [
          {
            type: 'op',
            action: 'message_merge',
            params: {
              text: '{{text}}',
              message: '{{original_message}}',
            },
            output_as: 'merged_message',
          },
        ],
      },
      output: {
        kind: 'message',
        name: 'message',
        method: 'build_output',
        display_name: 'Message',
        value_from: 'merged_message',
      },
    })

    const r = safeParseCubeCustomComponentDslV2(dsl)
    expect(r.success).toBe(true)

    const py = compileParsedDslV2(dsl)
    expect(py).toContain('HandleInput(')
    expect(py).toContain('input_types=["Message"]')
    expect(py).toContain('_merged_message_text = getattr(_merged_message_text_source, "text", None)')
    expect(py).toContain('_merged_message_original_text = getattr(_merged_message_source, "text", None)')
    expect(py).toContain('if not _merged_message_text and _merged_message_original_text:')
    expect(py).toContain(
      'merged_message = Message(text=str(_merged_message_text) if _merged_message_text is not None else "", sender="Machine", sender_name="AI")',
    )
    expect(py).toContain('if _merged_message_files is None and isinstance(_merged_message_source_data, dict):')
    expect(py).toContain('merged_message.files = _merged_message_files')
    expect(py).toContain('if not getattr(msg, "sender_name", None):')
    expect(buildCubeComponentSchemaFromDslPayload(dsl).inputs.find((i) => i.name === 'original_message')?.inputTypes).toEqual(['Message'])
    expect(buildCubeComponentSchemaFromDslPayload(dsl).outputs[0]!.types).toEqual(['Message'])
    expect(roughPythonBraceBalance(py).ok).toBe(true)
  })

  test('message_to_openai_content op converts Message files to OpenAI content parts', () => {
    const dsl = minimalV2({
      inputs: [
        {
          kind: 'handle',
          name: 'input',
          display_name: 'Input',
          input_types: ['Message'],
          required: false,
        },
      ],
      workflow: {
        blocks: [
          {
            type: 'op',
            action: 'message_to_openai_content',
            params: {
              message: '{{input}}',
            },
            output_as: 'user_content',
          },
        ],
      },
      output: {
        kind: 'data',
        name: 'output',
        method: 'build_output',
        display_name: 'Output',
        value_from: 'user_content',
      },
    })

    const r = safeParseCubeCustomComponentDslV2(dsl)
    expect(r.success).toBe(true)

    const py = compileParsedDslV2(dsl)
    expect(py).toContain('import base64')
    expect(py).toContain('import mimetypes')
    expect(py).toContain('import os')
    expect(py).toContain('import requests')
    expect(py).toContain('import urllib.parse')
    expect(py).toContain('from lfx.base.data.storage_utils import parse_storage_path, read_file_bytes')
    expect(py).toContain('from lfx.utils.async_helpers import run_until_complete')
    expect(py).toContain('_user_content_message_data = getattr(_user_content_message, "data", None)')
    expect(py).toContain('if not _user_content_text and isinstance(_user_content_message_data, dict):')
    expect(py).toContain('if _user_content_files is None and isinstance(_user_content_message_data, dict):')
    expect(py).toContain('user_content = str(_user_content_text or "")')
    expect(py).toContain('{"type": "text", "text": str(_user_content_text or "")}')
    expect(py).toContain('{"type": "image_url", "image_url": {"url": str(_user_content_url)}}')
    expect(py).toContain('_user_content_max_file_bytes = 20971520')
    expect(py).toContain('_user_content_raw_candidates.extend([_user_content_file.get("path"), _user_content_file.get("file_path"), _user_content_file.get("url")')
    expect(py).toContain('if parse_storage_path(_path):')
    expect(py).toContain('return run_until_complete(read_file_bytes(_path)), _path')
    expect(py).toContain('requests.get(_user_content_fetch_url, timeout=30)')
    expect(py).toContain('base64.b64encode(_user_content_bytes).decode("ascii")')
    expect(py).toContain('not str(_user_content_mime).lower().startswith("image/")')
    expect(py).toContain('if len(_user_content_bytes) > _user_content_max_file_bytes:')
    expect(py).toContain('raise RuntimeError("Message.files was provided but no image bytes could be read. "')
    expect(py).not.toContain('_user_content_url = _user_content_raw_url')
    expect(buildCubeComponentSchemaFromDslPayload(dsl).inputs[0]?.inputType).toBe('HandleInput')
    expect(roughPythonBraceBalance(py).ok).toBe(true)
  })

  test('message_to_openai_content op accepts custom local image size limit', () => {
    const dsl = minimalV2({
      inputs: [
        {
          kind: 'handle',
          name: 'input',
          display_name: 'Input',
          input_types: ['Message'],
          required: false,
        },
      ],
      workflow: {
        blocks: [
          {
            type: 'op',
            action: 'message_to_openai_content',
            params: {
              message: '{{input}}',
              max_file_bytes: 1024,
            },
            output_as: 'user_content',
          },
        ],
      },
      output: {
        kind: 'data',
        name: 'output',
        method: 'build_output',
        display_name: 'Output',
        value_from: 'user_content',
      },
    })

    const py = compileParsedDslV2(dsl)

    expect(py).toContain('_user_content_max_file_bytes = 1024')
    expect(roughPythonBraceBalance(py).ok).toBe(true)
  })

  test('http op emits requests + json', () => {
    const dsl = minimalV2({
      workflow: {
        blocks: [
          {
            type: 'op',
            action: 'http',
            params: {
              method: 'POST',
              url: 'http://example.com',
              timeout_ms: 300000,
              headers: { 'Content-Type': 'application/json' },
              body_type: 'json',
              body: { query: '{{input_value}}' },
            },
            output_as: 'raw',
          },
          { type: 'op', action: 'json_parse', params: { from: '{{raw}}' }, output_as: 'data' },
        ],
      },
    })
    const py = compileParsedDslV2(dsl)
    expect(py).toContain('import requests')
    expect(py).toContain('json.dumps(')
    expect(py).toContain('requests.request(')
    expect(py).toContain('timeout=300')
    expect(py).toMatch(/Content-Type.*application\/json|"application\/json"/)
    expect(listPipForDslV2(dsl).some((p) => p.name === 'requests')).toBe(true)
  })

  test('vector_store extends LCVectorStoreComponent and search_documents', () => {
    const dsl = minimalV2({
      extends: 'vector_store',
      workflow: {
        blocks: [
          {
            type: 'op',
            action: 'assign',
            params: { expr: '[]' },
            output_as: 'out',
          },
        ],
      },
    })
    const py = compileParsedDslV2(dsl)
    expect(py).toContain('class V2Demo(LCVectorStoreComponent):')
    expect(py).toContain('def search_documents(self) -> list[Data]:')
    expect(py).toContain('return out')
  })

  test('foreach emits for-loop', () => {
    const dsl = minimalV2({
      inputs: [
        {
          kind: 'str',
          name: 'items_json',
          display_name: 'Items',
          default: '[]',
        },
      ],
      workflow: {
        blocks: [
          { type: 'op', action: 'json_parse', params: { from: '{{items_json}}' }, output_as: 'items' },
          {
            type: 'foreach',
            over: '{{items}}',
            as: 'row',
            body: [
              {
                type: 'op',
                action: 'assign',
                params: { expr: '"x"' },
                output_as: 'last',
              },
            ],
          },
        ],
      },
    })
    const py = compileParsedDslV2(dsl)
    expect(py).toContain('for row in items:')
  })

  test('transform builds Data list', () => {
    const dsl = minimalV2({
      extends: 'vector_store',
      variables: [{ name: 'items', initial: '[]' }],
      workflow: {
        blocks: [
          {
            type: 'op',
            action: 'transform',
            params: {
              from: '{{items}}',
              mapping: {
                text: '$.text',
                data: { score: '$.score' },
              },
            },
            output_as: 'results',
          },
        ],
      },
    })
    const py = compileParsedDslV2(dsl)
    expect(py).toContain('.append(Data(')
    expect(py).toContain('for _it in items:')
  })

  test('prepare validates and compiles v2 graph', () => {
    const g = emptyCubeFlowGraph()
    g.nodes.push({
      id: 'n1',
      lfNodeId: 'lf1',
      cubeType: 'cube.lf.CustomComponent',
      x: 0,
      y: 0,
      width: 200,
      height: 80,
      config: { [CUBE_CUSTOM_COMPONENT_DSL_KEY]: JSON.stringify(minimalV2()) },
    })
    validateCubeCustomComponentGraph(g)
    const p = prepareCubeGraphLangflowExport(g)
    expect((p.nodes[0]!.config['code'] as string).includes('V2Demo')).toBe(true)
  })

  test('handle input emits HandleInput for ingest_data', () => {
    const dsl = minimalV2({
      inputs: [
        {
          kind: 'handle',
          name: 'ingest_data',
          display_name: 'Ingest Data',
          input_types: ['Data', 'DataFrame'],
          is_list: true,
          required: false,
        },
        {
          kind: 'message_text',
          name: 'input_value',
          display_name: 'Input',
          default: 'x',
          tool_mode: true,
        },
      ],
    })
    const py = compileParsedDslV2(dsl)
    expect(py).toContain('HandleInput(')
    expect(py).toContain('name="ingest_data"')
    expect(py).toContain('Ingest Data')
    expect(py).toContain('is_list=True')
  })

  test('traits and ui_rules appear as comments', () => {
    const dsl = minimalV2({
      traits: ['logging'],
      ui_rules: [{ if: "mode == 'local'", hide: ['api_url'] }],
    })
    const py = compileParsedDslV2(dsl)
    expect(py).toContain('# cube DSL traits:')
    expect(py).toContain('# cube DSL ui_rules:')
  })
})
