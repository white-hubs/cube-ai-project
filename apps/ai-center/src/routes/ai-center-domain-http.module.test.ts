import { describe, expect, test } from 'bun:test';
import { isGlobalModule } from '@dangao/bun-server';
import { AiCenterDomainHttpModule } from './ai-center-domain-http.module';
import { AiCenterKbHttpModule } from './ai-center-kb-http.module';

/**
 * 离线冒烟：两个 HTTP 域模块（DI 装配，重逻辑在工厂内、需 MySQL）至少应能
 * 离线 import 且保持 @Global 标记 —— 防止依赖图引入 import 期副作用或误删 @Global。
 */
describe('ai-center http modules (offline smoke)', () => {
  test('AiCenterDomainHttpModule is importable and marked @Global', () => {
    expect(typeof AiCenterDomainHttpModule).toBe('function');
    expect(isGlobalModule(AiCenterDomainHttpModule)).toBe(true);
  });

  test('AiCenterKbHttpModule is importable and marked @Global', () => {
    expect(typeof AiCenterKbHttpModule).toBe('function');
    expect(isGlobalModule(AiCenterKbHttpModule)).toBe(true);
  });
});
