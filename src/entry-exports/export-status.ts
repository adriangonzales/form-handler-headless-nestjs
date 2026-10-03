export enum ExportStatus {
  Pending = 'pending',
  Processing = 'processing',
  Completed = 'completed',
  Failed = 'failed',
}

/** Exports expire this many hours after creation. */
export const EXPORT_RETENTION_HOURS = 24;
