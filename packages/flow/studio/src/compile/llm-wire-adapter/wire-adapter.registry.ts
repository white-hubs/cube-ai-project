import type { WireAdapter } from './wire-context.types'
import { dashscopeMultimodalImageAdapter } from './adapters/dashscope.multimodal-image.adapter'
import { geekAiOpenAiChatAdapter } from './adapters/geekai.chat-extra-body.adapter'
import { openAiChatAdapter } from './adapters/openai.chat.adapter'
import { openAiImagesAdapter } from './adapters/openai.images.adapter'
import { seedreamOpenAiImagesAdapter } from './adapters/seedream.openai-images.adapter'
import { volcengineArkOpenAiImageAdapter } from './adapters/volcengine-ark.openai-image.adapter'

const adapters = new Map<string, WireAdapter>()

export function registerAdapter(adapter: WireAdapter): void {
  adapters.set(adapter.key, adapter)
}

export function getAdapter(key: string): WireAdapter {
  const adapter = adapters.get(key)
  if (!adapter) {
    throw new Error(`unsupported_adapter:${key}`)
  }
  return adapter
}

export function listAdapters(): WireAdapter[] {
  return Array.from(adapters.values())
}

export function registerDefaultWireAdapters(): void {
  for (const adapter of [
    openAiChatAdapter,
    geekAiOpenAiChatAdapter,
    openAiImagesAdapter,
    seedreamOpenAiImagesAdapter,
    volcengineArkOpenAiImageAdapter,
    dashscopeMultimodalImageAdapter,
  ]) {
    registerAdapter(adapter)
  }
}
