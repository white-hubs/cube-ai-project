/**
 * Preload script — installs happy-dom globals so Vue's reactivity / mount works under bun test.
 * Wired via `bunfig.toml`：`preload = ["./test/setup-happy-dom.ts"]`。
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";

if (globalThis.document === undefined) {
  GlobalRegistrator.register();
}
