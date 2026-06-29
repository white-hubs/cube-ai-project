export interface NacosServiceRef {
  serviceName: string;
  groupName: string;
}

export interface NacosServiceInstance {
  ip: string;
  port: number;
  healthy?: boolean;
  weight?: number;
  enabled?: boolean;
  metadata?: Record<string, string>;
}

const CATALOG_PAGE_SIZE = 100;
const MAX_CATALOG_PAGES = 20;

function appendOpenApiAuth(params: URLSearchParams, username?: string, password?: string): void {
  if (username) {
    params.set("username", username);
    params.set("password", password ?? "");
  }
}

function parseCatalogServiceList(json: unknown): NacosServiceRef[] {
  if (!json || typeof json !== "object") {
    return [];
  }
  const root = json as Record<string, unknown>;
  const rawList = root.serviceList ?? root.services;
  if (!Array.isArray(rawList)) {
    return [];
  }
  const out: NacosServiceRef[] = [];
  for (const item of rawList) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const row = item as Record<string, unknown>;
    const name = row.name;
    const groupName = row.groupName;
    if (typeof name === "string" && name !== "" && typeof groupName === "string" && groupName !== "") {
      out.push({ groupName, serviceName: name });
    }
  }
  return out;
}

export async function nacosFetchCatalogServicePageV1(params: {
  nacosBase: string;
  namespaceId?: string;
  pageNo: number;
  pageSize: number;
  username?: string;
  password?: string;
  fetchImpl?: typeof fetch;
}): Promise<{ items: NacosServiceRef[]; countHint: number }> {
  const fetchFn = params.fetchImpl ?? fetch;
  const search = new URLSearchParams();
  search.set("pageNo", String(params.pageNo));
  search.set("pageSize", String(params.pageSize));
  if (params.namespaceId) {
    search.set("namespaceId", params.namespaceId);
  }
  appendOpenApiAuth(search, params.username, params.password);
  const url = `${params.nacosBase}/nacos/v1/ns/catalog/services?${search.toString()}`;
  const response = await fetchFn(url);
  if (!response.ok) {
    return { countHint: 0, items: [] };
  }
  const json: unknown = await response.json();
  const rows = parseCatalogServiceList(json);
  const countHint =
    json && typeof json === "object" && typeof (json as { count?: unknown }).count === "number"
      ? ((json as { count: number }).count ?? 0)
      : rows.length;
  return {
    countHint,
    items: rows,
  };
}

export async function nacosFetchServiceDomsPageV1(params: {
  nacosBase: string;
  namespaceId?: string;
  groupName: string;
  pageNo: number;
  pageSize: number;
  username?: string;
  password?: string;
  fetchImpl?: typeof fetch;
}): Promise<string[]> {
  const fetchFn = params.fetchImpl ?? fetch;
  const search = new URLSearchParams();
  search.set("pageNo", String(params.pageNo));
  search.set("pageSize", String(params.pageSize));
  search.set("groupName", params.groupName);
  if (params.namespaceId) {
    search.set("namespaceId", params.namespaceId);
  }
  appendOpenApiAuth(search, params.username, params.password);
  const url = `${params.nacosBase}/nacos/v1/ns/service/list?${search.toString()}`;
  const response = await fetchFn(url);
  if (!response.ok) {
    return [];
  }
  const json: unknown = await response.json();
  if (!json || typeof json !== "object") {
    return [];
  }
  const doms = (json as { doms?: unknown }).doms;
  return Array.isArray(doms) ? doms.filter((d): d is string => typeof d === "string" && d !== "") : [];
}

export async function nacosListAllServiceRefsInNamespace(params: {
  nacosBase: string;
  namespaceId?: string;
  username?: string;
  password?: string;
  fetchImpl?: typeof fetch;
}): Promise<NacosServiceRef[]> {
  const seen = new Set<string>();
  const refs: NacosServiceRef[] = [];
  let pageNo = 1;
  let usedCatalog = false;

  while (pageNo <= MAX_CATALOG_PAGES) {
    const page = await nacosFetchCatalogServicePageV1({
      fetchImpl: params.fetchImpl,
      nacosBase: params.nacosBase,
      namespaceId: params.namespaceId,
      pageNo,
      pageSize: CATALOG_PAGE_SIZE,
      password: params.password,
      username: params.username,
    });
    if (page.items.length > 0) {
      usedCatalog = true;
    }
    for (const ref of page.items) {
      const key = `${ref.groupName}@@${ref.serviceName}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      refs.push(ref);
    }
    if (!usedCatalog && pageNo === 1 && page.items.length === 0) {
      break;
    }
    if (page.items.length < CATALOG_PAGE_SIZE) {
      break;
    }
    pageNo += 1;
  }

  if (refs.length > 0) {
    return refs;
  }

  pageNo = 1;
  while (pageNo <= MAX_CATALOG_PAGES) {
    const doms = await nacosFetchServiceDomsPageV1({
      fetchImpl: params.fetchImpl,
      groupName: "DEFAULT_GROUP",
      nacosBase: params.nacosBase,
      namespaceId: params.namespaceId,
      pageNo,
      pageSize: CATALOG_PAGE_SIZE,
      password: params.password,
      username: params.username,
    });
    for (const name of doms) {
      const ref: NacosServiceRef = { groupName: "DEFAULT_GROUP", serviceName: name };
      const key = `${ref.groupName}@@${ref.serviceName}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      refs.push(ref);
    }
    if (doms.length < CATALOG_PAGE_SIZE) {
      break;
    }
    pageNo += 1;
  }

  return refs;
}

export async function nacosFetchInstancesV1(params: {
  nacosBase: string;
  namespaceId?: string;
  groupName: string;
  serviceName: string;
  username?: string;
  password?: string;
  fetchImpl?: typeof fetch;
}): Promise<NacosServiceInstance[]> {
  const fetchFn = params.fetchImpl ?? fetch;
  const search = new URLSearchParams();
  search.set("serviceName", params.serviceName);
  search.set("groupName", params.groupName);
  if (params.namespaceId) {
    search.set("namespaceId", params.namespaceId);
  }
  appendOpenApiAuth(search, params.username, params.password);
  const url = `${params.nacosBase}/nacos/v1/ns/instance/list?${search.toString()}`;
  const response = await fetchFn(url);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Nacos instance query failed: ${response.status} ${text}`);
  }
  const data = (await response.json()) as {
    hosts?: {
      ip: string;
      port: number;
      healthy?: boolean;
      weight?: number;
      enabled?: boolean;
      metadata?: Record<string, string>;
    }[];
  };
  return (data.hosts ?? []).map((host) => ({
    enabled: host.enabled,
    healthy: host.healthy,
    ip: host.ip,
    metadata: host.metadata,
    port: host.port,
    weight: host.weight,
  }));
}

export function resolveGrpcPort(instance: NacosServiceInstance): number {
  const metadataPort = instance.metadata?.grpc_server_port ?? instance.metadata?.grpcPort;
  if (metadataPort !== undefined) {
    const parsed = Number.parseInt(String(metadataPort), 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return instance.port;
}

export function pickGrpcInstance(instances: readonly NacosServiceInstance[]): NacosServiceInstance | null {
  if (instances.length === 0) {
    return null;
  }
  const available = instances.filter((instance) => instance.enabled !== false && instance.healthy !== false);
  const preferred = available.find((instance) => {
    const metadataPort = instance.metadata?.grpc_server_port ?? instance.metadata?.grpcPort;
    if (metadataPort === undefined) {
      return false;
    }
    const parsed = Number.parseInt(String(metadataPort), 10);
    return Number.isFinite(parsed) && parsed > 0;
  });
  return preferred ?? available[0] ?? instances[0] ?? null;
}
