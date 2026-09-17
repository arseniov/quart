import { z } from 'zod';

// Polymorphic comment target — schema mirrors the CHECK constraint on
// `comments.parent_type` in 0005_content.up.sql.
export const TargetType = z.enum(['idea', 'issue', 'poll']);
export type TargetType = z.infer<typeof TargetType>;

// `comments.body` has a DB CHECK of length 1..5000.
export const CommentBody = z.string().min(1).max(5000);

export const ListCommentsQuery = z.object({
  targetType: TargetType,
  targetId: z.string().uuid(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type ListCommentsQuery = z.infer<typeof ListCommentsQuery>;

export const CreateCommentBody = z.object({
  targetType: TargetType,
  targetId: z.string().uuid(),
  body: CommentBody,
});
export type CreateCommentBody = z.infer<typeof CreateCommentBody>;

export const UpdateCommentBody = z.object({
  body: CommentBody,
});
export type UpdateCommentBody = z.infer<typeof UpdateCommentBody>;

// `comment_reactions.reaction` CHECK constraint: up | down.
export const ReactionType = z.enum(['up', 'down']);
export type ReactionType = z.infer<typeof ReactionType>;

export const ReactBody = z.object({
  reaction: ReactionType,
});
export type ReactBody = z.infer<typeof ReactBody>;
