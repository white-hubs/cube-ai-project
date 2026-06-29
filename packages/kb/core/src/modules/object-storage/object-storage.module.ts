import { Module } from "@dangao/bun-server";

import { APP_CONFIG_TOKEN, loadAppConfig } from "../../config/app.config";
import { ObjectStorageService } from "./services/object-storage.service";

const appConfig = await loadAppConfig();

@Module({
  exports: [APP_CONFIG_TOKEN, ObjectStorageService],
  providers: [{ provide: APP_CONFIG_TOKEN, useValue: appConfig }, ObjectStorageService],
})
export class ObjectStorageModule {}
