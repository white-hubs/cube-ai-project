import { describe, expect, it } from "bun:test";

import { pickGrpcInstance, resolveGrpcPort } from "./nacos-v1-discovery";

describe("nacos-v1-discovery", () => {
  it("prefers grpc_server_port metadata over registered port", () => {
    const picked = pickGrpcInstance([
      {
        enabled: true,
        healthy: true,
        ip: "10.0.0.8",
        metadata: { grpc_server_port: "9090" },
        port: 8080,
      },
    ]);
    expect(picked).not.toBeNull();
    expect(resolveGrpcPort(picked!)).toBe(9090);
  });
});
