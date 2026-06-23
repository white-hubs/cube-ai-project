/// <reference types="vite/client" />
/// <reference types="vue/jsx" />

interface ImportMetaEnv {
  readonly VITE_AI_CENTER_TENANT?: string;
  readonly VITE_AI_CENTER_TERMINAL?: string;
  readonly VITE_AI_CENTER_DEV_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
