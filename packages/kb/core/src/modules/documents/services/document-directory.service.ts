import { BadRequestException, Injectable, NotFoundException } from "@dangao/bun-server";

import { DocumentDirectoryRepositoryOrm } from "../infrastructure/orm/document-directory.repository";
import { DocumentRepositoryOrm } from "../infrastructure/orm/document.repository";
import { DocumentService } from "./document.service";
import type { ParsedPeriodRange } from "./period-range";

const DIRECTORY_DESCRIPTION_MAX = 2000;
const DIRECTORY_ICON_MAX = 512;

export interface DirectoryListItem {
  id: string;
  name: string;
  /** 目录描述 */
  description: string | null;
  /** 图标（URL 或业务标识） */
  icon: string | null;
  /** 目录下未删除文档数量 */
  documentCount: number;
  /** 目录下未删除文档的 size 字段合计（字节） */
  totalSizeBytes: number;
  /** 目录记录更新时间 */
  updateTime: Date;
}

export interface UpdateDirectoryInput {
  name?: string;
  description?: string | null;
  icon?: string | null;
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
      return;
    }
    if (typeof value !== "string") {
      throw new BadRequestException(`invalid ${field}`);
    }
    if (value.length > DIRECTORY_DESCRIPTION_MAX) {
      throw new BadRequestException(`description exceeds ${DIRECTORY_DESCRIPTION_MAX} characters`);
    }
  }

  private validateIcon(value: string | null | undefined, field: string): void {
    if (value === undefined || value === null) {
      return;
    }
    if (typeof value !== "string") {
      throw new BadRequestException(`invalid ${field}`);
    }
    if (value.length > DIRECTORY_ICON_MAX) {
      throw new BadRequestException(`icon exceeds ${DIRECTORY_ICON_MAX} characters`);
    }
  }

  public async createDirectory(params: { name: string; description?: string | null; icon?: string | null }): Promise<string> {
    const name = params.name;
    if (!name || typeof name !== "string" || name.trim() === "") {
      throw new BadRequestException("name is required");
    }
    const description = params.description === undefined ? null : params.description;
    const icon = params.icon === undefined ? null : params.icon;
    this.validateDescription(description, "description");
    this.validateIcon(icon, "icon");

    const dir = await this.directoryRepository.createDirectory({
      description,
      icon,
      name: name.trim(),
    });
    return dir.id;
  }

  public async listDirectories(): Promise<{ id: string; name: string; description: string | null; icon: string | null }[]> {
    const dirs = await this.directoryRepository.findAll();
    return dirs.map((d) => ({
      description: d.description ?? null,
      icon: d.icon ?? null,
      id: d.id,
      name: d.name,
    }));
  }

  public async searchDirectories(params: {
    pageNumber: number;
    pageSize: number;
    keyword: string | null;
    period?: ParsedPeriodRange;
  }): Promise<{ items: DirectoryListItem[]; total: number; pages: number }> {
    const { pageNumber, pageSize, keyword, period } = params;
    const result = await this.directoryRepository.searchDirectories({
      keyword,
      pageNumber,
      pageSize,
      period,
    });
    const pages = Math.ceil(result.total / pageSize);
    const directoryIds = result.items.map((d) => String(d.id));
    const statsMap = await this.documentRepository.aggregateDocumentStatsByDirectoryIds(directoryIds);
    const items: DirectoryListItem[] = result.items.map((d) => {
      const stats = statsMap.get(String(d.id)) ?? { documentCount: 0, totalSizeBytes: 0 };
      return {
        description: d.description ?? null,
        documentCount: stats.documentCount,
        icon: d.icon ?? null,
        id: String(d.id),
        name: d.name,
        totalSizeBytes: stats.totalSizeBytes,
        updateTime: d.update_time,
      };
    });
    return {
      items,
      pages,
      total: result.total,
    };
  }

  /**
   * 更新目录（名称、描述、图标至少传一项）。
   */
  public async updateDirectory(id: string, data: UpdateDirectoryInput): Promise<DirectoryListItem> {
    const has = data.name !== undefined || data.description !== undefined || data.icon !== undefined;
    if (!has) {
      throw new BadRequestException("at least one of name, description, icon is required");
    }
    const existing = await this.directoryRepository.findById(id);
    if (!existing) {
      throw new NotFoundException(`directory not found: ${id}`);
    }
    if (data.name !== undefined && (typeof data.name !== "string" || data.name.trim() === "")) {
      throw new BadRequestException("name cannot be empty");
    }
    this.validateDescription(data.description, "description");
    this.validateIcon(data.icon, "icon");

    const patch: { name?: string; description?: string | null; icon?: string | null } = {};
    if (data.name !== undefined) {
      patch.name = data.name.trim();
    }
    if (data.description !== undefined) {
      patch.description = data.description;
    }
    if (data.icon !== undefined) {
      patch.icon = data.icon;
    }

    const updated = await this.directoryRepository.updateDirectory(id, patch);
    const stats = await this.documentRepository.aggregateDocumentStatsByDirectoryIds([String(updated.id)]);
    const s = stats.get(String(updated.id)) ?? { documentCount: 0, totalSizeBytes: 0 };
    return {
      description: updated.description ?? null,
      documentCount: s.documentCount,
      icon: updated.icon ?? null,
      id: String(updated.id),
      name: updated.name,
      totalSizeBytes: s.totalSizeBytes,
      updateTime: updated.update_time,
    };
  }

  /**
   * 删除目录：先删除目录下全部文档（含向量与文件关联），再软删除目录记录。
   */
  public async deleteDirectory(id: string): Promise<{ ok: boolean }> {
    const dir = await this.directoryRepository.findById(id);
    if (!dir) {
      throw new NotFoundException(`directory not found: ${id}`);
    }
    const documentIds = await this.documentRepository.findIdsByDirectoryId(id);
    for (const docId of documentIds) {
      await this.documentService.deleteDocument(docId);
    }
    await this.directoryRepository.logicalDelete(id);
    return { ok: true };
  }
}
