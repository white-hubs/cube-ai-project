import { kbConsoleRequestJson, type KbConsoleConfig } from './http';

async function kbConsoleRequestFormData<T>(
  config: KbConsoleConfig,
  method: string,
  path: string,
  formData: FormData,
): Promise<T> {
  const prefix = config.pathPrefix ?? '/kb/console';
  const url = `${config.baseUrl.replace(/\/$/, '')}${prefix}${path}`;
  const extra =
    typeof config.headers === 'function' ? await config.headers() : (config.headers ?? {});
  const fetchImpl = config.fetchImpl ?? fetch;
  const res = await fetchImpl(url, {
    method,
    headers: {
      accept: 'application/json',
      ...extra,
    },
    body: formData,
  });
  if (!res.ok) {
    throw new Error(`kb-sdk-console ${method} ${path}: HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

export interface DocumentListItem {
  id: string;
  name: string;
  directoryId?: string;
}

export interface DocumentListResponse {
  items?: DocumentListItem[];
  documents?: DocumentListItem[];
}

export class KbConsoleClient {
  constructor(private readonly config: KbConsoleConfig) {}

  listDocuments(params?: { directoryId?: string }): Promise<DocumentListResponse> {
    const qs = params?.directoryId
      ? `?directoryId=${encodeURIComponent(params.directoryId)}`
      : '';
    return kbConsoleRequestJson<DocumentListResponse>(this.config, 'GET', `/documents${qs}`);
  }

  getDocument(documentId: string): Promise<DocumentListItem> {
    return kbConsoleRequestJson<DocumentListItem>(
      this.config,
      'GET',
      `/documents/${encodeURIComponent(documentId)}`,
    );
  }

  uploadDocument(formData: FormData): Promise<Record<string, unknown>> {
    return kbConsoleRequestFormData<Record<string, unknown>>(
      this.config,
      'POST',
      '/documents/upload',
      formData,
    );
  }

  previewDocument(formData: FormData): Promise<Record<string, unknown>> {
    return kbConsoleRequestFormData<Record<string, unknown>>(
      this.config,
      'POST',
      '/documents/preview',
      formData,
    );
  }

  previewDocumentById(documentId: string): Promise<Record<string, unknown>> {
    return kbConsoleRequestJson<Record<string, unknown>>(
      this.config,
      'POST',
      `/documents/${encodeURIComponent(documentId)}/preview`,
    );
  }

  getDocumentChunks(documentId: string): Promise<Record<string, unknown>> {
    return kbConsoleRequestJson<Record<string, unknown>>(
      this.config,
      'GET',
      `/documents/${encodeURIComponent(documentId)}/chunks`,
    );
  }

  updateDocumentChunk(
    documentId: string,
    chunkId: string,
    body: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    return kbConsoleRequestJson<Record<string, unknown>>(
      this.config,
      'PUT',
      `/documents/${encodeURIComponent(documentId)}/chunks/${encodeURIComponent(chunkId)}`,
      body,
    );
  }

  deleteDocument(documentId: string): Promise<Record<string, unknown>> {
    return kbConsoleRequestJson<Record<string, unknown>>(
      this.config,
      'DELETE',
      `/documents/${encodeURIComponent(documentId)}`,
    );
  }

  reindexDocument(
    documentId: string,
    body?: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    return kbConsoleRequestJson<Record<string, unknown>>(
      this.config,
      'POST',
      `/documents/${encodeURIComponent(documentId)}/reindex`,
      body,
    );
  }

  createDirectory(body: Record<string, unknown>): Promise<Record<string, unknown>> {
    return kbConsoleRequestJson<Record<string, unknown>>(
      this.config,
      'POST',
      '/documents/directories',
      body,
    );
  }

  listDirectories(body: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    return kbConsoleRequestJson<Record<string, unknown>>(
      this.config,
      'POST',
      '/documents/directories/list',
      body,
    );
  }

  updateDirectory(id: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    return kbConsoleRequestJson<Record<string, unknown>>(
      this.config,
      'PUT',
      `/documents/directories/${encodeURIComponent(id)}`,
      body,
    );
  }

  deleteDirectory(id: string): Promise<Record<string, unknown>> {
    return kbConsoleRequestJson<Record<string, unknown>>(
      this.config,
      'DELETE',
      `/documents/directories/${encodeURIComponent(id)}`,
    );
  }
}

export function createKbConsoleClient(config: KbConsoleConfig): KbConsoleClient {
  return new KbConsoleClient(config);
}
