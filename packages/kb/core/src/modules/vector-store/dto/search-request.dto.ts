export interface SearchRequestDto {
  query: string
  topK?: number
  documentId?: string
}
