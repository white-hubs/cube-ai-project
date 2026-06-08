import { Column, Entity, PrimaryKey } from '@dangao/bun-server'
import type { ImportJobStatus } from '../../../common/document-types'

@Entity('document_import_job')
export class ImportJobEntity {
  @PrimaryKey()
  id!: string

  @Column({ nullable: true })
  project_id!: string | null

  @Column({ nullable: true })
  deleted!: bigint | null

  @Column()
  create_by!: string

  @Column({ nullable: true })
  creator_id!: string | null

  @Column({ nullable: true })
  creator_type!: string | null

  @Column()
  create_time!: Date

  @Column()
  update_by!: string

  @Column({ nullable: true })
  updater_id!: string | null

  @Column({ nullable: true })
  updater_type!: string | null

  @Column()
  update_time!: Date

  @Column()
  document_id!: string

  @Column()
  status!: ImportJobStatus

  @Column({ nullable: true })
  error_message!: string | null

  @Column()
  chunk_count!: number
}
