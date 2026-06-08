/**
 * Row shapes for Jobs BC persistence (MySQL).
 * ref: docs/detailed-design/06-jobs/README.md §3.1
 */

export type JobStatusDb =
  | 'QUEUED'
  | 'RUNNING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export interface JobRow {
  id: string;
  tenant: number;
  sessionId: string | null;
  turnId: string | null;
  toolCallId: string | null;
  userId: string | null;
  kind: string;
  toolRef: string | null;
  queue: string;
  status: JobStatusDb;
  attempts: number;
  maxAttempts: number;
  timeoutMs: number;
  overallDeadlineTime: Date;
  inputSnapshotJson: string;
  principalSnapshotJson: string;
  resultRefJson?: string | null;
  errorCode?: string | null;
  errorDetailJson?: string | null;
  requiresNotification: boolean;
  createTime?: Date;
  updateTime?: Date;
  startTime?: Date | null;
  endTime?: Date | null;
}

export interface GrantExpiryCandidateRow {
  id: string;
  tenant: number;
  subjectUserId: string | null;
}

export interface MysqlConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}
