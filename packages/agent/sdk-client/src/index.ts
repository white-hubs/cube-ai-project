export * from './client';
export * from './errors';
export * from './sse-client';
export * from './session';
export * from './files';
export * from './grants';
export * from './tools';
export * from './jobs';
export * from './versioning';

// legacy re-exports (sse.ts retained for backward compat)
export * from './sse';

/** Re-export selected contracts types so SDK consumers can import them without
 * pulling `@cube-ai/contracts` directly. */
export type { SseEvent } from '@cube-ai/contracts';

export const SDK_CORE_VERSION = '0.0.1-alpha.1';
