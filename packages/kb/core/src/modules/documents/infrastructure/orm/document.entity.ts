import { Column, Entity, PrimaryKey } from "@dangao/bun-server";

import type { DocumentStatus, IndexStatus, ParseStatus } from "../../../common/document-types";

@Entity("document_record")
export class DocumentEntity {
  @PrimaryKey()
  /** 文档主键 */
  id!: string;

  @Column({ nullable: true })
  /** 平台项目隔离 */
  tenant_id!: string | null;

  @Column({ nullable: true })
  /** 软删除标记：deleted != null 表示已删除（具体含义以数据库为准） */
  deleted!: bigint | null;

  @Column()
  /** 创建者名称（用户名/主体名称） */
  create_by!: string;

  @Column({ nullable: true })
  /** 创建者主体 id */
  creator_id!: string | null;

  @Column({ nullable: true })
  /** 创建者主体类型 */
  creator_type!: string | null;

  @Column()
  /** 创建时间 */
  create_time!: Date;

  @Column()
  /** 更新者名称 */
  update_by!: string;

  @Column({ nullable: true })
  /** 更新者主体 id */
  updater_id!: string | null;

  @Column({ nullable: true })
  /** 更新者主体类型 */
  updater_type!: string | null;

  @Column()
  /** 更新时间 */
  update_time!: Date;

  @Column()
  /** 文档文件名（原始文件名） */
  name!: string;

  @Column()
  /** MIME 类型 */
  mime_type!: string;

  @Column()
  /** 文件扩展名（例如 pdf/docx） */
  extension!: string;

  @Column()
  /** 文件大小（字节数） */
  size!: number;

  @Column()
  /** 对象存储桶名 */
  storage_bucket!: string;

  @Column()
  /** 对象存储 key（用于定位文件） */
  storage_key!: string;

  @Column({ nullable: true })
  /** 所属目录主键：directory_id（知识库“目录 -> 文档”一层结构） */
  directory_id!: string | null;

  @Column()
  /** 文档状态（uploaded/parsing/indexed/failed/deleted/unsupported） */
  status!: DocumentStatus;

  @Column()
  /** 解析状态（pending/success/failed/unsupported） */
  parse_status!: ParseStatus;

  @Column()
  /** 索引状态（pending/success/failed/unsupported） */
  index_status!: IndexStatus;

  @Column({ nullable: true })
  /** 失败原因（可选） */
  error_message!: string | null;

  @Column()
  /** 文档被检索召回次数（按命中结果累加） */
  recall_count!: number;

  @Column()
  /** 正文总字符数（入库分段 text 长度之和，索引成功后更新） */
  char_count!: number;

  @Column({ nullable: true })
  /** 分段标识符（分段参数快照） */
  chunk_separator!: string | null;

  @Column({ nullable: true })
  /** 分段最大长度（分段参数快照） */
  chunk_size!: number | null;

  @Column({ nullable: true })
  /** 分段重叠长度（分段参数快照） */
  chunk_overlap!: number | null;

  @Column({ nullable: true })
  /** 表格分段模式（分段参数快照） */
  table_chunk_mode!: string | null;

  @Column({ nullable: true })
  /** 文本分段模式（分段参数快照） */
  text_chunk_mode!: string | null;

  @Column({ nullable: true })
  /** 源文件字节 sha256；未变更 reindex 可跳过 embed（W3.5） */
  content_checksum!: string | null;

  @Column({ nullable: true })
  /** 上次成功索引使用的 embedding modelCode（W3.5） */
  embedding_model_code!: string | null;

  @Column()
  /** 当前可检索的 chunk/Qdrant generation；重建成功后一次切换。 */
  active_generation_id!: string;

  @Column({ nullable: true })
  /** 最近一次获准切换 active generation 的导入任务；用于拒绝旧任务晚到覆盖。 */
  active_generation_job_id!: string | null;

  @Column({ nullable: true })
  /** 文档类型（W4.1 metadata filter） */
  doc_type!: string | null;

  @Column({ nullable: true })
  /** 语言代码（W4.1 metadata filter） */
  lang!: string | null;

  @Column({ nullable: true })
  /** 标签 JSON 数组（W4.1 metadata filter，AND） */
  tags_json!: string | null;

  @Column({ nullable: true })
  /** ACL 组 id JSON 数组；NULL/空 = 租户内可见（兼容期） */
  acl_group_ids_json!: string | null;

  @Column({ nullable: true })
  /** 自定义元数据 JSON bag（W4.1） */
  metadata_json!: string | null;
}
