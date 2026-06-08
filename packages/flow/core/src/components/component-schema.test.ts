import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { makeMockAppConfig } from '../test-helpers/mock-app-config'
import {
  AGENT_LLM_CONNECT_OTHER,
  buildDefaultToolsMetadataForToolMode,
  cubeToolModeActionLabels,
  deriveConnectablePorts,
  effectiveSchemaOutputTypes,
  ensureCubeConfigToolsMetadataForToolMode,
  expandAgentSchemaForCanvas,
  expandParserSchemaForCanvas,
  cubeConfigParserModeIsStringify,
  expandSchemaForCubeCanvas,
  orderInputsByFieldOrder,
  resolveFieldEnabledForCanvas,
  resolveFieldAdvancedForCanvas,
  portTypesCompatible,
  sanitizeFieldOrderForTemplate,
  semanticSourcePort,
  semanticTargetPort,
  toolMetadataActionLabels,
  type CubeComponentSchemaV1,
} from '../shared-imports/cube-component-schema'
import { clearLfApiAllCaches } from '../langflow/lf-api-all-registry'
import { ComponentSchemaService } from './component-schema.service'

import { flowCoreFixturePaths } from '../test-helpers/fixture-paths'

const MOCK_API_ALL_PATH = flowCoreFixturePaths.apiAllPath

function makeSvc(): ComponentSchemaService {
  clearLfApiAllCaches()
  return new ComponentSchemaService(
    makeMockAppConfig({
      paths: {
        langflowApiAllPath: MOCK_API_ALL_PATH,
        componentCatalogPath: '/app/data/cube-component-catalog.json',
        sqlitePath: '/app/data/cube-ai.sqlite',
      },
    }),
  )
}

describe('ComponentSchemaService', () => {
  test('Agent tools input is HandleInput (connection-only, not StrInput)', () => {
    const svc = makeSvc()
    const s = svc.getSchemaForCubeType('cube.lf.Agent')
    const tools = s.inputs.find((i) => i.name === 'tools')
    expect(tools?.inputType).toBe('HandleInput')
    expect(tools?.inputTypes).toContain('Tool')
  })

  test('Agent model (LF 1.8.2+) picks externalConnectAction from api-all', () => {
    const svc = makeSvc()
    const s = svc.getSchemaForCubeType('cube.lf.Agent')
    const ag = s.inputs.find((i) => i.name === 'model')
    expect(ag?.externalConnectAction?.name).toBe('connect_other_models')
    expect(ag?.externalConnectAction?.displayName).toBe('Connect other models')
  })

  test('Agent connect_other_models expands LanguageModel port on model and drops provider fields', () => {
    const svc = makeSvc()
    const s = svc.getSchemaForCubeType('cube.lf.Agent')
    const cfg = { model: AGENT_LLM_CONNECT_OTHER }
    const expanded = expandAgentSchemaForCanvas(s, cfg)
    expect(expanded.inputs.some((i) => i.name === 'api_key')).toBe(false)
    expect(expanded.inputs.some((i) => i.name === 'model_name')).toBe(false)
    const ag = expanded.inputs.find((i) => i.name === 'model')
    expect(ag?.displayName).toBe('Language Model')
    expect(ag?.inputTypes).toContain('LanguageModel')
    const ports = deriveConnectablePorts(expanded, cfg, undefined, false, undefined)
    expect(ports.some((p) => p.kind === 'in' && p.logicalName === 'model')).toBe(true)
  })

  test('cubeConfigParserModeIsStringify accepts trim and case', () => {
    expect(cubeConfigParserModeIsStringify({ mode: 'Stringify' })).toBe(true)
    expect(cubeConfigParserModeIsStringify({ mode: '  stringify  ' })).toBe(true)
    expect(cubeConfigParserModeIsStringify({ mode: 'Parser' })).toBe(false)
  })

  test('ParserComponent Stringify hides pattern (Template) in schema and ports', () => {
    const svc = makeSvc()
    const s = svc.getSchemaForCubeType('cube.lf.ParserComponent')
    expect(s.inputs.some((i) => i.name === 'pattern')).toBe(true)

    const expanded = expandParserSchemaForCanvas(s, { mode: 'Stringify' })
    expect(expanded.inputs.some((i) => i.name === 'pattern')).toBe(false)
    expect(expanded.fieldOrder?.includes('pattern')).toBe(false)
    const expandedLoose = expandParserSchemaForCanvas(s, { mode: '  STRINGIFY  ' })
    expect(expandedLoose.inputs.some((i) => i.name === 'pattern')).toBe(false)

    const full = expandSchemaForCubeCanvas(s, undefined, { mode: 'Stringify' }, undefined)
    expect(full.inputs.some((i) => i.name === 'pattern')).toBe(false)
    const ports = deriveConnectablePorts(full, { mode: 'Stringify' }, undefined, false, undefined)
    expect(ports.some((p) => p.kind === 'in' && p.logicalName === 'pattern')).toBe(false)
  })

  test('ParserComponent Parser mode clears fieldAdvanced.pattern so Template stays in basic form section', () => {
    const fa = { pattern: true, sep: true } as Record<string, boolean>
    expect(resolveFieldAdvancedForCanvas('ParserComponent', { mode: 'Parser' }, fa)).toEqual({ sep: true })
    expect(resolveFieldAdvancedForCanvas('ParserComponent', { mode: 'Stringify' }, fa)).toEqual(fa)
  })

  test('ParserComponent Parser mode ignores fieldEnabled.pattern from LF Stringify so Template port shows', () => {
    const svc = makeSvc()
    const s = svc.getSchemaForCubeType('cube.lf.ParserComponent')
    const expanded = expandSchemaForCubeCanvas(s, undefined, { mode: 'Parser' }, undefined)
    const fe = { pattern: false, mode: true, input_data: true } as Record<string, boolean>
    expect(resolveFieldEnabledForCanvas('ParserComponent', { mode: 'Parser' }, fe)).toEqual({
      mode: true,
      input_data: true,
    })
    const ports = deriveConnectablePorts(expanded, { mode: 'Parser' }, fe, false, undefined)
    expect(ports.some((p) => p.kind === 'in' && p.logicalName === 'pattern')).toBe(true)
  })

  test('Calculator tool_mode output carries method for Actions fallback', () => {
    const svc = makeSvc()
    const s = svc.getSchemaForCubeType('cube.lf.CalculatorComponent')
    const toolOut = s.outputs.find((o) => o.toolMode === true)
    expect(toolOut?.name).toBe('result')
    expect(toolOut?.method).toBe('evaluate_expression')
  })

  test('toolMetadataActionLabels and cubeToolModeActionLabels', () => {
    const meta = [
      { display_name: 'do_thing', name: 'x' },
      { name: 'only_name', display_name: '' },
    ]
    expect(toolMetadataActionLabels(meta)).toEqual(['do_thing', 'Only Name'])
    expect(
      cubeToolModeActionLabels(meta, { toolMode: true, method: 'fallback_method' }),
    ).toEqual(['do_thing', 'Only Name'])
    expect(cubeToolModeActionLabels([], { toolMode: true, method: 'm' })).toEqual(['m'])
    expect(cubeToolModeActionLabels(undefined, { toolMode: false, method: 'm' })).toEqual([])
  })

  test('ensureCubeConfigToolsMetadataForToolMode fills default from schema', () => {
    const svc = makeSvc()
    const s = svc.getSchemaForCubeType('cube.lf.CalculatorComponent')
    const { config, didChange } = ensureCubeConfigToolsMetadataForToolMode({}, s, true, 0)
    expect(didChange).toBe(true)
    const meta = config['tools_metadata']
    expect(Array.isArray(meta) && meta.length).toBe(1)
    const row = (meta as unknown[])[0] as Record<string, unknown>
    expect(row['name']).toBe('evaluate_expression')
    expect(buildDefaultToolsMetadataForToolMode(s, 0)[0]?.['display_name']).toBe('evaluate_expression')
    const again = ensureCubeConfigToolsMetadataForToolMode(config, s, true, 0)
    expect(again.didChange).toBe(false)
  })

  test('ChatInput inputs follow api-all field_order (input_value first)', () => {
    const svc = makeSvc()
    const s = svc.getSchemaForCubeType('cube.lf.ChatInput')
    expect(s.inputs[0]?.name).toBe('input_value')
    expect(s.fieldOrder?.[0]).toBe('input_value')
  })

  test('SmartRouter routes TableInput carries table_schema columns', () => {
    const svc = makeSvc()
    const s = svc.getSchemaForCubeType('cube.lf.SmartRouter')
    const routes = s.inputs.find((i) => i.name === 'routes')
    expect(routes?.inputType).toBe('TableInput')
    expect(routes?.tableSchema?.length).toBe(3)
    expect(routes?.tableSchema?.[0]?.name).toBe('route_category')
    expect(routes?.triggerText).toBe('Open table')
  })

  test('SmartRouter deriveConnectablePorts builds outputs from routes + optional Else', () => {
    const svc = makeSvc()
    const s = svc.getSchemaForCubeType('cube.lf.SmartRouter')
    const cfg: Record<string, unknown> = {
      routes: [
        { route_category: '111', route_description: '', output_value: '' },
        { route_category: '222', route_description: '', output_value: '' },
      ],
      enable_else_output: false,
    }
    const ports = deriveConnectablePorts(s, cfg)
    const outs = ports.filter((p) => p.kind === 'out')
    expect(outs.map((p) => p.logicalName)).toEqual(['category_1_result', 'category_2_result'])
    expect(outs.map((p) => p.displayLabel)).toEqual(['111', '222'])
    expect(outs.every((p) => p.types.includes('Message'))).toBe(true)

    const cfgElse = { ...cfg, enable_else_output: true }
    const outsElse = deriveConnectablePorts(s, cfgElse).filter((p) => p.kind === 'out')
    expect(outsElse.map((p) => p.logicalName)).toEqual([
      'category_1_result',
      'category_2_result',
      'default_result',
    ])
    expect(outsElse[2]?.displayLabel).toBe('Else')
  })

  test('getSchemasForCubeTypes dedupes and skips unknown', () => {
    const svc = makeSvc()
    const list = svc.getSchemasForCubeTypes([
      'cube.lf.ChatInput',
      'cube.lf.ChatInput',
      'cube.lf.__DefinitelyMissing__',
      'cube.lf.Agent',
    ])
    const keys = new Set(list.map((s) => s.cubeType))
    expect(keys.has('cube.lf.ChatInput')).toBe(true)
    expect(keys.has('cube.lf.Agent')).toBe(true)
    expect(keys.has('cube.lf.__DefinitelyMissing__')).toBe(false)
    expect(list.length).toBe(2)
  })

  test('AIMLModel schema has outputs and connectable message inputs', () => {
    const svc = makeSvc()
    const s = svc.getSchemaForCubeType('cube.lf.AIMLModel')
    expect(s.version).toBe(1)
    expect(s.outputs.some((o) => o.name === 'text_output')).toBe(true)
    expect(s.inputs.some((i) => i.name === 'input_value' && i.inputTypes.includes('Message'))).toBe(true)
    const ports = deriveConnectablePorts(s, {})
    expect(ports.filter((p) => p.kind === 'out').length).toBe(s.outputs.length)
    expect(ports.some((p) => p.logicalName === 'input_value')).toBe(true)
  })

  test('deriveConnectablePorts nodeToolMode hides template tool_mode inputs on canvas', () => {
    const s: CubeComponentSchemaV1 = {
      version: 1,
      cubeType: 'cube.lf.FakeTool',
      lfComponentKey: 'FakeTool',
      displayName: 'Fake',
      description: '',
      componentToolModeDefault: false,
      outputs: [
        { name: 'o1', displayName: 'O', types: ['Message'], toolMode: false, allowsLoop: false },
      ],
      inputs: [
        {
          name: 'tool_in',
          displayName: 'Tool in',
          inputTypes: ['Message'],
          advanced: false,
          show: true,
          password: false,
          inputType: 'StrInput',
          fieldType: 'str',
          info: '',
          required: false,
          fieldToolMode: true,
          value: '',
        },
        {
          name: 'normal_in',
          displayName: 'Normal',
          inputTypes: ['Data'],
          advanced: false,
          show: true,
          password: false,
          inputType: 'StrInput',
          fieldType: 'str',
          info: '',
          required: false,
          fieldToolMode: false,
          value: '',
        },
      ],
    }
    const ports = deriveConnectablePorts(s, {}, null, true)
    expect(ports.filter((p) => p.kind === 'in').map((p) => p.logicalName)).toEqual(['normal_in'])
  })

  test('effectiveSchemaOutputTypes adds Tool for tool_mode output when node is in tool mode', () => {
    expect(effectiveSchemaOutputTypes(['Data'], true, true)).toEqual(['Data', 'Tool'])
    expect(effectiveSchemaOutputTypes(['Tool'], true, true)).toEqual(['Tool'])
    expect(effectiveSchemaOutputTypes(['Data'], true, false)).toEqual(['Data'])
    expect(effectiveSchemaOutputTypes(['Data'], false, true)).toEqual(['Data'])
  })

  test('deriveConnectablePorts Calculator in node tool mode marks output with Tool and schemaOutputToolMode', () => {
    const svc = makeSvc()
    const s = svc.getSchemaForCubeType('cube.lf.CalculatorComponent')
    const ports = deriveConnectablePorts(s, {}, null, true)
    const out = ports.filter((p) => p.kind === 'out')
    expect(out.length).toBe(1)
    expect(out[0]!.types).toContain('Tool')
    expect(out[0]!.types).toContain('Data')
    expect(out[0]!.schemaOutputToolMode).toBe(true)
  })

  test('deriveConnectablePorts Agent in node tool mode shows tools + system_prompt, not input_value', () => {
    const svc = makeSvc()
    const s = svc.getSchemaForCubeType('cube.lf.Agent')
    const ports = deriveConnectablePorts(s, {}, null, true)
    const ins = ports.filter((p) => p.kind === 'in').map((p) => p.logicalName)
    expect(ins).toContain('tools')
    expect(ins).toContain('system_prompt')
    expect(ins).not.toContain('input_value')
  })

  test('deriveConnectablePorts respects fieldEnabled override', () => {
    const svc = makeSvc()
    const s = svc.getSchemaForCubeType('cube.lf.AIMLModel')
    const withOverride = deriveConnectablePorts(s, {}, { input_value: false })
    expect(withOverride.some((p) => p.kind === 'in' && p.logicalName === 'input_value')).toBe(false)
  })

  test('portTypesCompatible respects type intersection', () => {
    expect(portTypesCompatible(['Message'], ['Message'])).toBe(true)
    expect(portTypesCompatible(['Tool'], ['Message'])).toBe(false)
    expect(portTypesCompatible([], ['Message'])).toBe(true)
  })

  test('semantic ports use lfNodeId segment', () => {
    expect(semanticSourcePort('AIMLModel-x', 'text_output')).toBe('cube.sp/o/AIMLModel-x/text_output')
    expect(semanticTargetPort('Agent-y', 'tools')).toBe('cube.sp/i/Agent-y/tools')
  })
})

describe('sanitizeFieldOrderForTemplate', () => {
  test('drops names not in template, dedupes, accepts slot name alias', () => {
    const template = {
      _type: 'Component',
      x: { value: 1 },
      y: { name: 'alias_y', value: 2 },
    }
    expect(sanitizeFieldOrderForTemplate(['ghost', 'x', 'alias_y', 'x', 'y'], template)).toEqual([
      'x',
      'alias_y',
      'y',
    ])
  })

  test('without template falls back to dedupe only', () => {
    expect(sanitizeFieldOrderForTemplate(['a', 'b', 'a'], undefined)).toEqual(['a', 'b'])
  })

  test('orderInputsByFieldOrder with sanitized list matches template fields', () => {
    const inputs = [{ name: 'm' }, { name: 'z' }, { name: 'a' }]
    const template = { _type: 'C', z: { value: 0 }, a: { value: 0 }, m: { value: 0 } }
    const fo = sanitizeFieldOrderForTemplate(['z', 'ghost', 'a', 'm'], template)
    expect(orderInputsByFieldOrder(inputs, fo).map((i) => i.name)).toEqual(['z', 'a', 'm'])
  })
})
