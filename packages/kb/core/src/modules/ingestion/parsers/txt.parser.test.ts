import { describe, expect, test } from 'bun:test'
import { TxtParser } from './txt.parser'

describe('TxtParser', () => {
  test('formats sdk instruction text into chunk-friendly sections', async () => {
    const parser = new TxtParser()
    const content = [
      `切换模型时间 { action: 'changeModelTime' params: { value: 'day' } }`,
      `切换模型天气 { action: 'changeModelWeather' params: { value: 'Sunny' } }`,
    ].join(' ')

    const parsed = await parser.parse({
      filename: 'sdk.txt',
      file: new File([content], 'sdk.txt', { type: 'text/plain' }),
      mimeType: 'text/plain',
    })

    expect(parsed.text).toContain('### 指令 1')
    expect(parsed.text).toContain('### 指令 2')
    expect(parsed.text).toContain('changeModelTime')
    expect(parsed.text).toContain('changeModelWeather')
  })
})
