import { type ServiceInstance, type ServiceRegistry } from "@dangao/bun-server";
import { describe, expect, mock, test } from "bun:test";

import { type NacosRegistrationOptions, NacosServiceRegistrationService } from "./service-registration.service";

function fakeRegistry() {
  const calls = { close: 0, deregister: 0, register: [] as ServiceInstance[] };
  const registry: ServiceRegistry = {
    close: mock(async () => {
      calls.close += 1;
    }),
    deregister: mock(async () => {
      calls.deregister += 1;
    }),
    getInstances: mock(async () => []),
    register: mock(async (i: ServiceInstance) => {
      calls.register.push(i);
    }),
    renew: mock(async () => {}),
    watchInstances: mock(() => () => {}),
  } as unknown as ServiceRegistry;
  return { calls, registry };
}

const opts: NacosRegistrationOptions = {
  grpcPort: 3110,
  ip: "127.0.0.1",
  port: 3210,
  refreshTtlMs: 0, // disable periodic refresh timer in tests
  serviceName: "aiCenter",
};

describe("NacosServiceRegistrationService", () => {
  test("registers with grpc_server_port metadata on init", async () => {
    const { registry, calls } = fakeRegistry();
    const svc = new NacosServiceRegistrationService(registry, opts);
    await svc.onModuleInit();
    expect(calls.register.length).toBe(1);
    expect(calls.register[0]?.metadata?.grpc_server_port).toBe("3110");
    expect(svc.isConnected()).toBe(true);
    await svc.onModuleDestroy();
    expect(calls.deregister).toBe(1);
    expect(calls.close).toBe(1);
  });

  test("survives registry failure (connected=false, no throw)", async () => {
    const registry = {
      close: mock(async () => {}),
      deregister: mock(async () => {}),
      getInstances: mock(async () => []),
      register: mock(async () => {
        throw new Error("nacos down");
      }),
      renew: mock(async () => {}),
      watchInstances: mock(() => () => {}),
    } as unknown as ServiceRegistry;
    const svc = new NacosServiceRegistrationService(registry, opts);
    await svc.onModuleInit();
    expect(svc.isConnected()).toBe(false);
    await svc.onModuleDestroy();
  });

  test("skips register when registerEnabled=false", async () => {
    const { registry, calls } = fakeRegistry();
    const svc = new NacosServiceRegistrationService(registry, {
      ...opts,
      registerEnabled: false,
    });
    await svc.onModuleInit();
    expect(calls.register.length).toBe(0);
    expect(svc.isConnected()).toBe(false);
    await svc.onModuleDestroy();
    expect(calls.deregister).toBe(0);
    expect(calls.close).toBe(0);
  });
});
