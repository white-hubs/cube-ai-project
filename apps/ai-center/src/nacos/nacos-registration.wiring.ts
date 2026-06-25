import { Module, ServiceRegistryModule } from "@dangao/bun-server";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  NACOS_REGISTRATION_OPTIONS_TOKEN,
  NacosServiceRegistrationService,
  type NacosRegistrationOptions,
} from "@cube-ai/bun-server-ext-nacos";

interface WiringFileConfig {
  name?: string;
  port?: number;
  hostname?: string;
  grpcPort?: number;
  registerGrpcPort?: number;
  registerHostname?: string;
  nacosServerAddr?: string;
  nacosNamespace?: string;
  nacosUsername?: string;
  nacosPassword?: string;
}

function normalizeNacosServerAddr(value: string): string {
  const trimmed = value.trim();
  if (trimmed === "") {
    return "http://127.0.0.1:8848";
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  return trimmed.includes(":") ? `http://${trimmed}` : `http://${trimmed}:8848`;
}

function getCliArg(name: string): string | undefined {
  const argv = process.argv.slice(2).map((value) => String(value ?? ""));
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) continue;
    if (arg.startsWith(`--${name}=`)) {
      return arg.substring(name.length + 3);
    }
    if (arg === `--${name}` && index + 1 < argv.length) {
      return argv[index + 1];
    }
  }
  return undefined;
}

function searchConfigUpwardSync(startDir: string): string | null {
  let currentDir = path.resolve(startDir);
  while (true) {
    const candidate = path.join(currentDir, "config", "app.json");
    if (fs.existsSync(candidate)) {
      return candidate;
    }
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      return null;
    }
    currentDir = parentDir;
  }
}

function getEntryScriptDir(): string | null {
  const entry = process.argv[1];
  if (!entry) {
    return null;
  }
  const resolvedEntry = path.isAbsolute(entry) ? entry : path.resolve(process.cwd(), entry);
  return path.dirname(resolvedEntry);
}

function resolveDefaultConfigPathSync(): string | null {
  const roots = [process.cwd(), getEntryScriptDir() ?? ""];
  const dedupedRoots = Array.from(new Set(roots.map((root) => root.trim()).filter((root) => root !== "")));
  for (const root of dedupedRoots) {
    const resolved = searchConfigUpwardSync(root);
    if (resolved) {
      return resolved;
    }
  }
  return null;
}

function loadConfigFileSync(): WiringFileConfig {
  const configPath = process.env.APP_CONFIG_PATH ?? resolveDefaultConfigPathSync();
  if (!configPath) {
    return {};
  }
  try {
    const text = fs.readFileSync(configPath, "utf8");
    const data = JSON.parse(text) as WiringFileConfig;
    return typeof data === "object" && data !== null ? data : {};
  } catch {
    return {};
  }
}

function resolveNacosConfig(): {
  nacosServerAddr: string;
  nacosNamespace: string;
  nacosUsername?: string;
  nacosPassword?: string;
} {
  const fileConfig = loadConfigFileSync();
  return {
    nacosServerAddr:
      getCliArg("nacos-server-addr") ??
      process.env.NACOS_ADDRESS ??
      process.env.NACOS_SERVER_ADDR ??
      fileConfig.nacosServerAddr ??
      "localhost:8848",
    nacosNamespace: getCliArg("nacos-namespace") ?? process.env.NACOS_NAMESPACE ?? fileConfig.nacosNamespace ?? "",
    nacosUsername: getCliArg("nacos-username") ?? process.env.NACOS_USERNAME ?? fileConfig.nacosUsername ?? undefined,
    nacosPassword: getCliArg("nacos-password") ?? process.env.NACOS_PASSWORD ?? fileConfig.nacosPassword ?? undefined,
  };
}

const nacosConfig = resolveNacosConfig();
const nacosServerAddr = normalizeNacosServerAddr(nacosConfig.nacosServerAddr);

function readPortSync(envKey: string, fallback: number): number {
  const raw = getCliArg(envKey.toLowerCase().replace(/_/g, "-")) ?? process.env[envKey];
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** 首个非内网回环的 IPv4；用于裸机/host 网络下的自动通告。容器 bridge 网络下应显式设 AI_CENTER_REGISTER_IP。 */
function detectLanIpv4(): string | undefined {
  const ifaces = os.networkInterfaces();
  for (const infos of Object.values(ifaces)) {
    for (const info of infos ?? []) {
      if (info.family === "IPv4" && !info.internal && info.address) {
        return info.address;
      }
    }
  }
  return undefined;
}

/**
 * 注册到 Nacos 的 IP 是“对外通告地址”，必须可被兄弟服务到达：
 * 优先显式 AI_CENTER_REGISTER_IP（容器/NAT 必填，填宿主可达 IP）→ 非 0.0.0.0 的 register-hostname →
 * 自动探测 LAN IPv4（裸机/host 网络）→ 最后兜底 127.0.0.1。
 */
/** Opt-in：仅 `1` / `true` / `yes` 启用；缺省与其它值均不注册。 */
export function isAiCenterNacosRegisterEnabled(): boolean {
  const raw = (getCliArg("nacos-register") ?? process.env.AI_CENTER_NACOS_REGISTER ?? "0").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

function resolveRegisterIp(fileConfig: WiringFileConfig): string {
  const explicit = (getCliArg("register-ip") ?? process.env.AI_CENTER_REGISTER_IP)?.trim();
  if (explicit) {
    return explicit;
  }
  const hostname = (
    getCliArg("register-hostname") ??
    process.env.AI_CENTER_REGISTER_HOSTNAME ??
    fileConfig.registerHostname ??
    fileConfig.hostname ??
    ""
  ).trim();
  if (hostname && hostname !== "0.0.0.0") {
    return hostname;
  }
  return detectLanIpv4() ?? "127.0.0.1";
}

export function resolveRegistrationOptions(): NacosRegistrationOptions {
  const fileConfig = loadConfigFileSync();
  const serviceName = getCliArg("app-name") ?? process.env.APP_NAME ?? fileConfig.name ?? "aiCenter";
  const port = readPortSync("AI_CENTER_REGISTER_PORT", readPortSync("AI_CENTER_PORT", Number(fileConfig.port ?? 3210)));
  const grpcPort = readPortSync(
    "AI_CENTER_REGISTER_GRPC_PORT",
    readPortSync("AI_CENTER_GRPC_PORT", Number(fileConfig.registerGrpcPort ?? fileConfig.grpcPort ?? 3110)),
  );
  const ip = resolveRegisterIp(fileConfig);
  return {
    serviceName,
    ip,
    port,
    grpcPort,
    registerEnabled: isAiCenterNacosRegisterEnabled(),
  };
}

export function buildServiceRegistryModule(): typeof ServiceRegistryModule {
  return ServiceRegistryModule.forRoot({
    provider: "nacos",
    autoRegister: false,
    nacos: {
      client: {
        serverList: [nacosServerAddr],
        namespaceId: nacosConfig.nacosNamespace || undefined,
        username: nacosConfig.nacosUsername,
        password: nacosConfig.nacosPassword,
      },
      watchInterval: 5000,
      heartbeatInterval: 5000,
    },
  });
}

export const nacosRegistrationProviders = [
  { provide: NACOS_REGISTRATION_OPTIONS_TOKEN, useValue: resolveRegistrationOptions() },
  NacosServiceRegistrationService,
];

@Module({
  imports: [buildServiceRegistryModule()],
  providers: nacosRegistrationProviders,
  exports: [NacosServiceRegistrationService],
})
export class AiCenterNacosRegistrationModule {}
