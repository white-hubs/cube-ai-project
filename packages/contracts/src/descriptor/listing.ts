import { z } from 'zod';

export const ListDescriptorRequestSchema = z.object({
  versionNo: z.number().int().positive(),
});
export type ListDescriptorRequest = z.infer<typeof ListDescriptorRequestSchema>;

export const DescriptorListingViewSchema = z.object({
  descriptorId: z.string(),
  listed: z.boolean(),
  sharedVersionNo: z.number().int(),
  publisherUserId: z.string(),
  listedTime: z.number().nullable(),
  unlistedTime: z.number().nullable(),
});
export type DescriptorListingView = z.infer<typeof DescriptorListingViewSchema>;
