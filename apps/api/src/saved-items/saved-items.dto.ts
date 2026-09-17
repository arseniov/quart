import { z } from 'zod';

export const SavedItemKindSchema = z.enum(['issue', 'idea', 'poll']);

export const SaveItemSchema = z.object({
  kind: SavedItemKindSchema,
  // `targetId` is the polymorphic PK of the bookmarked row. We accept any UUID
  // here — referential integrity is enforced at the application boundary for
  // polymorphic targets where no single FK exists.
  targetId: z.string().uuid(),
});
export type SaveItemBody = z.infer<typeof SaveItemSchema>;

export const SavedItemIdSchema = z.object({
  id: z.string().uuid(),
});
export type SavedItemIdParam = z.infer<typeof SavedItemIdSchema>;
