import { z } from 'zod';

/**
 * Epoch milliseconds. All time fields carry the `_time` suffix in DB and
 * `Time` suffix on the app layer (regulation §R4). ISO-8601 strings are
 * forbidden in both DTOs and DB columns.
 *
 * ref: docs/detailed-design/00-foundations/naming-and-db-conventions.md §4.1
 */
export const EpochMsSchema = z.number().int().nonnegative();
export type EpochMs = z.infer<typeof EpochMsSchema>;
