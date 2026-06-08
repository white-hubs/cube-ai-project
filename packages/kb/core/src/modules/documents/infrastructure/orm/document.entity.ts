import { Column, Entity, PrimaryKey } from '@dangao/bun-server'
import type { DocumentStatus, IndexStatus, ParseStatus } from '../../../common/document-types'

@Entity('document_record')
export class DocumentEntity {
  @PrimaryKey()
  /** 文档主键 */
  id!: string

  @Column({ nullable: true })
  /** 平台项目隔离 */
  project_id!: string | null

  @Column({ nullable: true })
  /** 软删除标记：deleted != null 表示已删除（具体含义以数据库为准） */
  deleted!: bigint | null

  @Column()
  /** 创建者名称（用户名/主体名称） */
  create_by!: string

  @Column({ nullable: true })
  /** 创建者主体 id */
  creator_id!: string | null

  @Column({ nullable: true })
  /** 创建者主体类型 */
  creator_type!: string | null

  @Column()
  /** 创建时间 */
  create_time!: Date

  @Column()
  /** 更新者名称 */
  update_by!: string

  @Column({ nullable: true })
  /** 更新者主体 id */
  updater_id!: string | null

  @Column({ nullable: true })
  /** 更新者主体类型 */
  updater_type!: string | null

  @Column()
  /** 更新时间 */
  update_time!: Date

  @Column()
  /** 文档文件名（原始文件名） */
  name!: string

  @Column()
  /** MIME 类型 */
  mime_type!: string

  @Column()
  /** 文件扩展名（例如 pdf/docx） */
  extension!: string

  @Column()
  /** 文件大小（字节数） */
  size!: number

  @Column()
  /** 对象存储桶名 */
  storage_bucket!: string

  @Column()
  /** 对象存储 key（用于定位文件） */
  storage_key!: string

  @Column({ nullable: true })
  /** 所属目录主键：directory_id（知识库“目录 -> 文档”一层结构） */
  directory_id!: string | null

  @Column()
  /** 文档状态（uploaded/parsing/indexed/failed/deleted/unsupported） */
  status!: DocumentStatus

  @Column()
  /** 解析状态（pending/success/failed/unsupported） */
  parse_status!: ParseStatus

  @Column()
  /** 索引状态（pending/success/failed/unsupported） */
  index_status!: IndexStatus

  @Column({ nullable: true })
  /** 失败原因（可选） */
  error_message!: string | null

  @Column()
  /** 文档被检索召回次数（按命中结果累加） */
  recall_count!: number

  @Column()
  /** 正文总字符数（入库分段 text 长度之和，索引成功后更新） */
  char_count!: number

  @Column({ nullable: true })
  /** 分段标识符（分段参数快照） */
  chunk_separator!: string | null

  @Column({ nullable: true })
  /** 分段最大长度（分段参数快照） */
  chunk_size!: number | null

  @Column({ nullable: true })
  /** 分段重叠长度（分段参数快照） */
  chunk_overlap!: number | null

  @Column({ nullable: true })
  /** 表格分段模式（分段参数快照） */
  table_chunk_mode!: string | null

  @Column({ nullable: true })
  /** 文本分段模式（分段参数快照） */
  text_chunk_mode!: string | null
}
