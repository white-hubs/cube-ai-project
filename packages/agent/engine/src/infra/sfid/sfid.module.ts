import { Module } from '@dangao/bun-server';
import { SfidService } from './sfid.service';

@Module({
  providers: [SfidService],
  exports: [SfidService],
})
export class SfidModule {}
