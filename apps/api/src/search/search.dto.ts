import { z } from 'zod';

// `polls` has no `search_tsv` column (0009 only adds FTS to issues / ideas /
// comments). The service falls back to ILIKE for kind='poll'. The other
// three kinds all share the `simple` tsvector config so we use it uniformly.
export const SearchKind = z.enum(['issue', 'idea', 'comment', 'poll']);
export type SearchKind = z.infer<typeof SearchKind>;

// `q` mirrors the 200-char ceiling on issues.title/ideas.title (0005_content).
export const SearchQuery = z.object({
  q: z.string().min(1).max(200),
  kind: SearchKind.optional(),
  cityId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type SearchQuery = z.infer<typeof SearchQuery>;