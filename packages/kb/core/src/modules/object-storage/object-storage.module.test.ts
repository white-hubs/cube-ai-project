import { Application, ModuleRegistry } from '@dangao/bun-server'
import { describe, expect, test } from 'bun:test'
import { ObjectStorageService } from './services/object-storage.service'
import { ObjectStorageModule } from './object-storage.module'

describe('ObjectStorageModule', () => {
  test('registers ObjectStorageService with all constructor dependencies', () => {
    const app = new Application({ enableSignalHandlers: false })

    app.registerModule(ObjectStorageModule)

    const moduleRef = ModuleRegistry.getInstance().getModuleRef(ObjectStorageModule)
    expect(moduleRef).toBeDefined()

    const service = moduleRef?.container.resolve(ObjectStorageService)
    expect(service).toBeInstanceOf(ObjectStorageService)
  })
})
