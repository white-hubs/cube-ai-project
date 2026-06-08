import { Module } from '@dangao/bun-server';
import { TACHU_SAFETY_MODULE_TOKEN } from '../tokens';
import { BaselineSafetyAdapter } from './baseline-safety';

@Module({
  providers: [
    {
      provide: TACHU_SAFETY_MODULE_TOKEN,
      useClass: BaselineSafetyAdapter,
    },
  ],
  exports: [TACHU_SAFETY_MODULE_TOKEN],
})
export class TachuSafetyModule {}
