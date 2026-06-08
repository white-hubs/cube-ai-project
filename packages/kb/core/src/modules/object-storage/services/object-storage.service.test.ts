import { describe, expect, test } from 'bun:test'
import { ObjectStorageService } from './object-storage.service'
import { makeMockAppConfig } from '../../../test-helpers/mock-app-config'

describe('ObjectStorageService', () => {
  test('constructs with injected AppConfig', () => {
    expect(new ObjectStorageService(makeMockAppConfig())).toBeInstanceOf(ObjectStorageService)
  })
})
