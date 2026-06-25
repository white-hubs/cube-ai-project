import {
  Inject,
  Injectable,
  SERVICE_REGISTRY_TOKEN,
  type OnModuleDestroy,
  type OnModuleInit,
  type ServiceInstance,
  type ServiceRegistry,
} from '@dangao/bun-server'

export const NACOS_REGISTRATION_OPTIONS_TOKEN = Symbol.for(
  '@cube-ai/bun-server-ext-nacos:RegistrationOptions',
)

export interface NacosRegistrationOptions {
  serviceName: string
  ip: string
  port: number
  grpcPort: number
  /** false → skip register/heartbeat/deregister (AI_CENTER_NACOS_REGISTER=0). */
  registerEnabled?: boolean
  version?: string
  heartbeatIntervalMs?: number
  refreshTtlMs?: number
}

/** 入站 Nacos 服务注册：register + 心跳 + 定期重注册 + deregister（ADR-0028）。 */
@Injectable()
export class NacosServiceRegistrationService implements OnModuleInit, OnModuleDestroy {
  private connected = false
  private instance: ServiceInstance | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private refreshTimer: ReturnType<typeof setInterval> | null = null
  private heartbeatInFlight = false
  private refreshInFlight = false

  constructor(
    @Inject(SERVICE_REGISTRY_TOKEN) private readonly serviceRegistry: ServiceRegistry,
    @Inject(NACOS_REGISTRATION_OPTIONS_TOKEN) private readonly options: NacosRegistrationOptions,
  ) {}

  private buildInstance(): ServiceInstance {
    return {
      serviceName: this.options.serviceName,
      ip: this.options.ip,
      port: this.options.port,
      weight: 1,
      healthy: true,
      enabled: true,
      metadata: {
        version: this.options.version ?? '0.0.1',
        grpc_server_port: String(this.options.grpcPort),
      },
    }
  }

  async onModuleInit(): Promise<void> {
    if (this.options.registerEnabled === false) {
      console.info(
        '[NacosRegistration] registration disabled (set AI_CENTER_NACOS_REGISTER=1 to enable)',
      )
      return
    }

    this.instance = this.buildInstance()
    console.info(
      `[NacosRegistration] registering service=${this.instance.serviceName} ip=${this.instance.ip} port=${this.instance.port} grpc=${this.options.grpcPort}`,
    )
    try {
      await this.serviceRegistry.register(this.instance)
      this.connected = true
      this.startHeartbeat()
      this.startRefresh()
    } catch (error) {
      console.warn(
        '[NacosRegistration] Nacos unreachable, skipping registration (peer discovery limited).',
        error,
      )
      this.connected = false
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.stopHeartbeat()
    this.stopRefresh()
    if (this.options.registerEnabled === false) {
      return
    }
    if (this.instance && this.connected) {
      try {
        await this.serviceRegistry.deregister(this.instance)
      } catch (error) {
        console.warn('[NacosRegistration] deregister failed', error)
      }
    }
    try {
      await this.serviceRegistry.close()
    } catch (error) {
      console.warn('[NacosRegistration] registry close failed', error)
    }
    this.connected = false
  }

  isConnected(): boolean {
    return this.connected
  }

  private startHeartbeat(): void {
    this.stopHeartbeat()
    const ms = this.options.heartbeatIntervalMs ?? 5000
    this.heartbeatTimer = setInterval(() => void this.sendHeartbeat(), ms)
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer != null) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  private startRefresh(): void {
    const ms = this.options.refreshTtlMs ?? 30000
    if (ms <= 0) return
    this.stopRefresh()
    this.refreshTimer = setInterval(() => void this.refreshRegistration(), ms)
  }

  private stopRefresh(): void {
    if (this.refreshTimer != null) {
      clearInterval(this.refreshTimer)
      this.refreshTimer = null
    }
  }

  private async sendHeartbeat(): Promise<void> {
    if (!this.instance || this.heartbeatInFlight) return
    this.heartbeatInFlight = true
    try {
      await this.serviceRegistry.renew(this.instance)
      this.connected = true
    } catch (error) {
      console.error('[NacosRegistration] heartbeat failed, re-registering', error)
      try {
        await this.serviceRegistry.register(this.instance)
        this.connected = true
      } catch (registerError) {
        console.error('[NacosRegistration] re-register failed', registerError)
        this.connected = false
      }
    } finally {
      this.heartbeatInFlight = false
    }
  }

  private async refreshRegistration(): Promise<void> {
    if (!this.instance || this.refreshInFlight) return
    this.refreshInFlight = true
    try {
      await this.serviceRegistry.register(this.instance)
      this.connected = true
    } catch (error) {
      console.error('[NacosRegistration] periodic re-register failed', error)
      this.connected = false
    } finally {
      this.refreshInFlight = false
    }
  }
}
