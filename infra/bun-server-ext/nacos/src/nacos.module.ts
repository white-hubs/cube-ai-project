import { Module } from "@dangao/bun-server";

import { NacosConfigObserverService } from "./observer.service";

export const NACOS_CONFIG_OBSERVER_TOKEN = Symbol.for("@cube-ai/bun-server-ext-nacos:ConfigObserver");

@Module({
  exports: [NacosConfigObserverService, NACOS_CONFIG_OBSERVER_TOKEN],
  providers: [
    NacosConfigObserverService,
    {
      provide: NACOS_CONFIG_OBSERVER_TOKEN,
      useClass: NacosConfigObserverService,
    },
  ],
})
export class NacosExtModule {}
