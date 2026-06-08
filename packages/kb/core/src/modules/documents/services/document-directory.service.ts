import { BadRequestException, Injectable, NotFoundException } from '@dangao/bun-server'
import { DocumentDirectoryRepositoryOrm } from '../infrastructure/orm/document-directory.repository'
import { DocumentRepositoryOrm } from '../infrastructure/orm/document.repository'
import type { ParsedPeriodRange } from './period-range'
import { DocumentService } from './document.service'

const DIRECTORY_DESCRIPTION_MAX = 2000
const DIRECTORY_ICON_MAX = 512

export interface DirectoryListItem {
  id: string
  name: string
  /** 目录描述 */
  description: string | null
  /** 图标（URL 或业务标识） */
  icon: string | null
  /** 目录下未删除文档数量 */
  documentCount: number
  /** 目录下未删除文档的 size 字段合计（字节） */
  totalSizeBytes: number
  /** 目录记录更新时间 */
  updateTime: Date
}

export interface UpdateDirectoryInput {
  name?: string
  description?: string | null
  icon?: string | null
}

@Injectable()
export class DocumentDirectoryService {
  public constructor(
    private readonly directoryRepository: DocumentDirectoryRepositoryOrm,
    private readonly documentRepository: DocumentRepositoryOrm,
    private readonly documentService: DocumentService,
  ) {}

  private validateDescription(value: string | null | undefined, field: string): void {
    if (value === undefined || value === null) {
      return
    }
    if (typeof value !== 'string') {
      throw new BadRequestException(`invalid ${field}`)
    }
    if (value.length > DIRECTORY_DESCRIPTION_MAX) {
      throw new BadRequestException(`description exceeds ${DIRECTORY_DESCRIPTION_MAX} characters`)
    }
  }

  private validateIcon(value: string | null | undefined, field: string): void {
    if (value === undefined || value === null) {
      return
    }
    if (typeof value !== 'string') {
      throw new BadRequestException(`invalid ${field}`)
    }
    if (value.length > DIRECTORY_ICON_MAX) {
      throw new BadRequestException(`icon exceeds ${DIRECTORY_ICON_MAX} characters`)
    }
  }

  public async createDirectory(params: {
    name: string
    description?: string | null
    icon?: string | null
  }): Promise<string> {
    const name = params.name
    if (!name || typeof name !== 'string' || name.trim() === '') {
      throw new BadRequestException('name is required')
    }
    const description = params.description === undefined ? null : params.description
    const icon = params.icon === undefined ? null : params.icon
    this.validateDescription(description, 'description')
    this.validateIcon(icon, 'icon')

    const dir = await this.directoryRepository.createDirectory({
      name: name.trim(),
      description,
      icon,
    })
    return dir.id
  }

  public async listDirectories(): Promise<
    Array<{ id: string; name: string; description: string | null; icon: string | null }>
  > {
    const dirs = await this.directoryRepository.findAll()
    return dirs.map((d) => ({
      id: d.id,
      name: d.name,
      description: d.description ?? null,
      icon: d.icon ?? null,
    }))
  }

  public async searchDirectories(params: {
    pageNumber: number
    pageSize: number
    keyword: string | null
    period?: ParsedPeriodRange
  }): Promise<{ items: DirectoryListItem[]; total: number; pages: number }> {
    const { pageNumber, pageSize, keyword, period } = params
    const result = await this.directoryRepository.searchDirectories({
      pageNumber,
      pageSize,
      keyword,
      period,
    })
    const pages = Math.ceil(result.total / pageSize)
    const directoryIds = result.items.map((d) => String(d.id))
    const statsMap = await this.documentRepository.aggregateDocumentStatsByDirectoryIds(directoryIds)
    const items: DirectoryListItem[] = result.items.map((d) => {
      const stats = statsMap.get(String(d.id)) ?? { documentCount: 0, totalSizeBytes: 0 }
      return {
        id: String(d.id),
        name: d.name,
        description: d.description ?? null,
        icon: d.icon ?? null,
        documentCount: stats.documentCount,
        totalSizeBytes: stats.totalSizeBytes,
        updateTime: d.update_time,
      }
    })
    return {
      items,
      total: result.total,
      pages,
    }
  }

  /**
   * 更新目录（名称、描述、图标至少传一项）。
   */
  public async updateDirectory(id: string, data: UpdateDirectoryInput): Promise<DirectoryListItem> {
    const has =
      data.name !== undefined
      || data.description !== undefined
      || data.icon !== undefined
    if (!has) {
      throw new BadRequestException('at least one of name, description, icon is required')
    }
    const existing = await this.directoryRepository.findById(id)
    if (!existing) {
      throw new NotFoundException(`directory not found: ${id}`)
    }
    if (data.name !== undefined) {
      if (typeof data.name !== 'string' || data.name.trim() === '') {
        throw new BadRequestException('name cannot be empty')
      }
    }
    this.validateDescription(data.description, 'description')
    this.validateIcon(data.icon, 'icon')

    const patch: { name?: string; description?: string | null; icon?: string | null } = {}
    if (data.name !== undefined) {
      patch.name = data.name.trim()
    }
    if (data.description !== undefined) {
      patch.description = data.description
    }
    if (data.icon !== undefined) {
      patch.icon = data.icon
    }

    const updated = await this.directoryRepository.updateDirectory(id, patch)
    const stats = await this.documentRepository.aggregateDocumentStatsByDirectoryIds([String(updated.id)])
    const s = stats.get(String(updated.id)) ?? { documentCount: 0, totalSizeBytes: 0 }
    return {
      id: String(updated.id),
      name: updated.name,
      description: updated.description ?? null,
      icon: updated.icon ?? null,
      documentCount: s.documentCount,
      totalSizeBytes: s.totalSizeBytes,
      updateTime: updated.update_time,
    }
  }

  /**
   * 删除目录：先删除目录下全部文档（含向量与文件关联），再软删除目录记录。
   */
  public async deleteDirectory(id: string): Promise<{ ok: boolean }> {
    const dir = await this.directoryRepository.findById(id)
    if (!dir) {
      throw new NotFoundException(`directory not found: ${id}`)
    }
    const documentIds = await this.documentRepository.findIdsByDirectoryId(id)
    for (const docId of documentIds) {
      await this.documentService.deleteDocument(docId)
    }
    await this.directoryRepository.logicalDelete(id)
    return { ok: true }
  }
}
