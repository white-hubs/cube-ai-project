// P1-01: tenant-context.service.ts is the canonical implementation;
// the Phase 0a placeholder tenant-context.ts was deleted during Phase 2.B
// merge of m2-phase1/api (closes P1-01 design doc §13 A-3).
export * from './tenant-context.service';
export * from './tenant-context.middleware';
export * from './tenant-guard.module';
export * from './isolation-matrix';
export * from './tenant-isolation.check';
