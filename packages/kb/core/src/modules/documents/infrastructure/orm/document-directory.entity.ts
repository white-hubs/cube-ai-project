import { Column, Entity, PrimaryKey } from '@dangao/bun-server'

@Entity('document_directory_record')
export class DocumentDirectoryEntity {
  @PrimaryKey()
  /** 目录主键 */
  id!: string

  @Column({ nullable: true })
  /** 平台项目隔离 */
  tenant_id!: string | null

  @Column({ nullable: true })
  /** 软删除标记 */
  deleted!: bigint | null

  @Column()
  /** 创建者名称 */
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
  /** 目录名称 */
  name!: string

  @Column({ nullable: true })
  /** 目录描述 */
  description!: string | null

  @Column({ nullable: true })
  /** 图标（URL 或业务约定的标识） */
  icon!: string | null
}

