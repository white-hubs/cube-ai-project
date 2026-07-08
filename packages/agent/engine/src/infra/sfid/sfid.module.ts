import { Module } from "@dangao/bun-server";

import { SfidService } from "./sfid.service";
import { sharedSfidService } from "./shared-sfid";

/**
 * Fix A 1a — 单生成器：DI 的 `@Inject(SfidService)` 与直连 `sharedSfidService`
 * 必须是**同一实例**，否则同进程两个生成器（同 nodeId、各自 seq）也能撞出重复
 * sessionId/turnId。用 `useValue` 把 provider 绑定到共享单例。
 */
@Module({
  providers: [{ provide: SfidService, useValue: sharedSfidService }],
  exports: [SfidService],
})
export class SfidModule {}
