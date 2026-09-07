import { z } from 'zod';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type Brand<T, B extends string> = T & { readonly __brand: B };

export type UserId = Brand<string, 'UserId'>;
export type CityId = Brand<string, 'CityId'>;
export type IssueId = Brand<string, 'IssueId'>;
export type IdeaId = Brand<string, 'IdeaId'>;
export type PollId = Brand<string, 'PollId'>;
export type CommentId = Brand<string, 'CommentId'>;

type IdForKind = {
  user: UserId;
  city: CityId;
  issue: IssueId;
  idea: IdeaId;
  poll: PollId;
  comment: CommentId;
};

export function brandedIdSchema<K extends keyof IdForKind>(_kind: K) {
  return z.string().regex(UUID_RE) as unknown as z.ZodType<IdForKind[K]>;
}

export const UserIdSchema = z.string().uuid().brand<'UserId'>();
