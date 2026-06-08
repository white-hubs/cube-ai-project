import { Module } from '@dangao/bun-server'
import { loadAppConfig, APP_CONFIG_TOKEN } from '../../config/app.config'
import { ObjectStorageService } from './services/object-storage.service'

const appConfig = await loadAppConfig()

@Module({
  providers: [
    { provide: APP_CONFIG_TOKEN, useValue: appConfig },
    ObjectStorageService,
  ],
  exports: [APP_CONFIG_TOKEN, ObjectStorageService],
})
export class ObjectStorageModule {}
