export interface QdrantConnectionConfig {
  url: string;
  apiKey?: string;
}

/** Minimal REST client surface used by vector-qdrant (fakeable in tests). */
export interface QdrantRestClientLike {
  upsert(collectionName: string, payload: Record<string, unknown>): Promise<unknown>;
  getCollection(collectionName: string): Promise<Record<string, unknown>>;
  count(collectionName: string, payload: Record<string, unknown>): Promise<{ count?: number }>;
  delete(collectionName: string, payload: Record<string, unknown>): Promise<unknown>;
  query(collectionName: string, payload: Record<string, unknown>): Promise<{ points: Array<{ id: unknown; score: number; payload?: Record<string, unknown> }> }>;
  createCollection(name: string, payload: Record<string, unknown>): Promise<unknown>;
}

export interface QdrantClientLike {
  getClient(): Promise<QdrantRestClientLike>;
}

export class QdrantClient implements QdrantClientLike {
  private clientPromise: Promise<QdrantRestClientLike> | null = null;

  constructor(private readonly config: QdrantConnectionConfig) {}

  async getClient(): Promise<QdrantRestClientLike> {
    if (!this.clientPromise) {
      this.clientPromise = this.createClient();
    }
    return this.clientPromise;
  }

  private async createClient(): Promise<QdrantRestClientLike> {
    const { QdrantClient: QdrantRestClient } = await import('@qdrant/js-client-rest');
    return new QdrantRestClient({
      url: this.config.url,
      apiKey: this.config.apiKey,
      checkCompatibility: false,
    }) as unknown as QdrantRestClientLike;
  }
}
