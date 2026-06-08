import { Injectable } from '@dangao/bun-server';

/** P3-05 可替换为真实 Turn 并发登记实现 */
export const TURN_REGISTRY_TOKEN = Symbol.for('agentic.infra.turnRegistry');

export interface TurnRegistry {
  /** 当前 RUNNING turn 近似计数（进程内） */
  getActiveCount(): number;
}

@Injectable()
export class NoopTurnRegistry implements TurnRegistry {
  getActiveCount(): number {
    return 0;
  }
}
