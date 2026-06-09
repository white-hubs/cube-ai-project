export type {
  CanonicalChatRequest,
  CanonicalImageRequest,
  ChannelProfile,
  EncodedHttpRequest,
  WireAdapter,
  WireContext,
} from './wire-context.types'
export { getAdapter, listAdapters, registerAdapter, registerDefaultWireAdapters } from './wire-adapter.registry'
export { resolveWireSize } from './transforms/size-transform'
export { mergeExtraBodyFields, supportsExtraBodyEnableThinking } from './transforms/extra-body-merge'
