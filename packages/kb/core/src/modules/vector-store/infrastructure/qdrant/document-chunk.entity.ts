import { Column, Entity, PrimaryKey } from "@dangao/bun-server";

@Entity("document_chunk")
export class DocumentChunkEntity {
  @PrimaryKey()
  id!: string;

  @Column({ nullable: true })
  tenant_id!: string | null;

  @Column({ nullable: true })
  deleted!: bigint | null;

  @Column()
  create_by!: string;

  @Column({ nullable: true })
  creator_id!: string | null;

  @Column({ nullable: true })
  creator_type!: string | null;

  @Column()
  create_time!: Date;

  @Column()
  update_by!: string;

  @Column({ nullable: true })
  updater_id!: string | null;

  @Column({ nullable: true })
  updater_type!: string | null;

  @Column()
  update_time!: Date;

  @Column()
  document_id!: string;

  @Column()
  /** Versioned rebuild generation; only document_record.active_generation_id is visible. */
  generation_id!: string;

  @Column()
  file_name!: string;

  @Column()
  source_type!: string;

  @Column()
  chunk_id!: string;

  @Column()
  qdrant_point_id!: string;

  @Column()
  chunk_index!: number;

  @Column()
  text_content!: string;

  @Column()
  embedding_text!: string;

  @Column({ nullable: true })
  /** sha256(embeddingText|modelCode|instructionProfile|algoVersion)（W3.5） */
  embedding_fingerprint!: string | null;

  @Column()
  /** 分段正文字符数（与 text_content 长度一致，便于列表展示与统计） */
  char_count!: number;

  @Column()
  /** 该分段被检索命中次数（按命中结果累加） */
  recall_count!: number;

  @Column()
  section_id!: string;

  @Column()
  heading_path!: string;

  @Column({ nullable: true })
  page_no!: number | null;

  @Column()
  chunk_type!: string;

  @Column()
  order_in_section!: number;

  @Column({ nullable: true })
  caption_text!: string | null;

  @Column({ nullable: true })
  picture_description!: string | null;

  @Column({ nullable: true })
  sheet_name!: string | null;

  @Column({ nullable: true })
  table_id!: string | null;

  @Column({ nullable: true })
  row_start!: number | null;

  @Column({ nullable: true })
  row_end!: number | null;

  @Column({ nullable: true })
  headers_text!: string | null;

  @Column({ nullable: true })
  keywords_text!: string | null;

  @Column({ nullable: true })
  start_time!: string | null;

  @Column({ nullable: true })
  end_time!: string | null;

  @Column({ nullable: true })
  cue_index!: number | null;

  @Column({ nullable: true })
  property_namespace!: string | null;

  @Column({ nullable: true })
  /** 自 document_record 反规范化（W4.1 词法腿过滤） */
  doc_type!: string | null;

  @Column({ nullable: true })
  lang!: string | null;

  @Column({ nullable: true })
  tags_json!: string | null;

  @Column({ nullable: true })
  /** NULL/空 = 租户内可见（兼容期）；非空则需与 allowedGroupIds 交集 */
  acl_group_ids_json!: string | null;

  @Column({ nullable: true })
  /** 文档 create_time 反规范化，供 Qdrant payload */
  doc_created_at!: Date | null;
}
