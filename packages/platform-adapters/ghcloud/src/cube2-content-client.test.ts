import { describe, expect, it } from 'bun:test'
import { getKnowledgeBaseClient } from './cube2-content-client'

describe('cube2-content-client', () => {
  it('exports getKnowledgeBaseClient as a function', () => {
    expect(typeof getKnowledgeBaseClient).toBe('function')
  })

  it('returns a Promise (lazy init — does not connect at import time)', () => {
    const savedBaseUrl = process.env['CUBE2_CONTENT_SERVICE_BASE_URL']
    const savedNacos = process.env['NACOS_ADDRESS']
    const savedNacosServerAddr = process.env['NACOS_SERVER_ADDR']
    delete process.env['CUBE2_CONTENT_SERVICE_BASE_URL']
    delete process.env['NACOS_ADDRESS']
    delete process.env['NACOS_SERVER_ADDR']

    const result = getKnowledgeBaseClient()
    expect(result).toBeInstanceOf(Promise)

    // Restore env
    if (savedBaseUrl !== undefined) process.env['CUBE2_CONTENT_SERVICE_BASE_URL'] = savedBaseUrl
    if (savedNacos !== undefined) process.env['NACOS_ADDRESS'] = savedNacos
    if (savedNacosServerAddr !== undefined) process.env['NACOS_SERVER_ADDR'] = savedNacosServerAddr

    // The promise rejects because no endpoint is configured
    return expect(result).rejects.toThrow()
  })
})
