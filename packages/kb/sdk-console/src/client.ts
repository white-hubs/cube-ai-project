import { kbConsoleRequestJson, type KbConsoleConfig } from './http';

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
}

export function createKbConsoleClient(config: KbConsoleConfig): KbConsoleClient {
  return new KbConsoleClient(config);
}
