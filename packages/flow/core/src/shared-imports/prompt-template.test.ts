import { describe, expect, test } from 'bun:test'
import {
  extractPromptPlaceholderNames,
  findPromptInputSlotName,
  promptTemplateBodyFromConfig,
  resolvePromptTemplateVariableNames,
} from './prompt-template'

describe('prompt-template', () => {
  test('extractPromptPlaceholderNames dedupes and skips escaped braces', () => {
    expect(extractPromptPlaceholderNames('Hello {name} and {other}')).toEqual(['name', 'other'])
    expect(extractPromptPlaceholderNames('{{no}} {yes}')).toEqual(['yes'])
    expect(extractPromptPlaceholderNames('{a} {a}')).toEqual(['a'])
  })

  test('promptTemplateBodyFromConfig reads string, value object, nested template', () => {
    expect(promptTemplateBodyFromConfig({ template: 'x' }, 'template')).toBe('x')
    expect(
      promptTemplateBodyFromConfig({ template: { value: 'nested' } } as Record<string, unknown>, 'template'),
    ).toBe('nested')
    expect(promptTemplateBodyFromConfig({ template: 1 } as Record<string, unknown>, 'template')).toBe('1')
    expect(promptTemplateBodyFromConfig({}, 'template')).toBe('')
  })

  test('resolvePromptTemplateVariableNames prefers body placeholders over custom_fields', () => {
    const cfg = { tpl: 'Use {foo} and {bar}' }
    expect(
      resolvePromptTemplateVariableNames({ tpl: ['wrong'] } as Record<string, unknown>, cfg, 'tpl'),
    ).toEqual(['foo', 'bar'])
  })

  test('resolvePromptTemplateVariableNames falls back to custom_fields string array', () => {
    const cfg = { tpl: '' }
    expect(resolvePromptTemplateVariableNames({ tpl: ['a', 'b'] }, cfg, 'tpl')).toEqual(['a', 'b'])
  })

  test('findPromptInputSlotName finds PromptInput or prompt fieldType', () => {
    expect(
      findPromptInputSlotName([
        { name: 'x', inputType: 'Str', fieldType: 'str' },
        { name: 'body', inputType: 'PromptInput', fieldType: 'prompt' },
      ]),
    ).toBe('body')
    expect(findPromptInputSlotName([{ name: 'p', inputType: 'Str', fieldType: 'prompt' }])).toBe('p')
    expect(findPromptInputSlotName([])).toBe('template')
  })
})
