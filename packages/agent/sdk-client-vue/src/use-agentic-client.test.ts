import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, describe, expect, test } from "bun:test";

/**
 * use-agentic-client 单元测试（离线）：
 *   - provideAgenticClient 在父组件 provide，子组件 useAgenticClient 拿到同一实例
 *   - app.provide(AGENTIC_CLIENT_KEY, ...) 路径同样可被 useAgenticClient 注入
 *   - 无 provider 时 useAgenticClient 抛出明确错误
 *
 * 与 provide-assistant.test.ts 相同：文件内自注册 happy-dom，
 * 保证从仓库根（root bunfig preload 不含 happy-dom）运行也通过。
 */

const registeredHappyDomForThisFile = globalThis.document === undefined;
if (registeredHappyDomForThisFile) {
  GlobalRegistrator.register();
}
const { defineComponent, h, createApp } = await import("vue");
const { provideAgenticClient, useAgenticClient, AGENTIC_CLIENT_KEY } = await import("./use-agentic-client");
const { AgenticClient } = await import("@cube-ai/agent-sdk-client");

afterAll(async () => {
  if (registeredHappyDomForThisFile) {
    await GlobalRegistrator.unregister();
  }
});

function mount(Root: ReturnType<typeof defineComponent>): () => void {
  const app = createApp(Root);
  const host = document.createElement("div");
  document.body.append(host);
  app.mount(host);
  return () => {
    app.unmount();
    host.remove();
  };
}

describe("provideAgenticClient / useAgenticClient", () => {
  test("子组件 useAgenticClient 拿到父组件 provide 的同一实例", () => {
    let provided: InstanceType<typeof AgenticClient> | undefined;
    let injected: InstanceType<typeof AgenticClient> | undefined;
    const Child = defineComponent({
      setup() {
        injected = useAgenticClient();
        return () => h("span");
      },
    });
    const Root = defineComponent({
      setup() {
        provided = provideAgenticClient({ baseUrl: "http://engine.test" });
        return () => h(Child);
      },
    });
    const unmount = mount(Root);
    expect(provided).toBeInstanceOf(AgenticClient);
    expect(injected).toBe(provided!);
    unmount();
  });

  test("app.provide(AGENTIC_CLIENT_KEY, client) 路径可注入", () => {
    const client = new AgenticClient({ baseUrl: "http://engine.test" });
    let injected: InstanceType<typeof AgenticClient> | undefined;
    const Root = defineComponent({
      setup() {
        injected = useAgenticClient();
        return () => h("span");
      },
    });
    const app = createApp(Root);
    app.provide(AGENTIC_CLIENT_KEY, client);
    const host = document.createElement("div");
    document.body.append(host);
    app.mount(host);
    expect(injected).toBe(client);
    app.unmount();
    host.remove();
  });

  test("无 provider 时 useAgenticClient 抛出明确错误", () => {
    let caught: unknown;
    const Root = defineComponent({
      setup() {
        try {
          useAgenticClient();
        } catch (e) {
          caught = e;
        }
        return () => h("span");
      },
    });
    const unmount = mount(Root);
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toContain("AgenticClient is not provided");
    unmount();
  });
});
