import { z } from 'zod';

export const PollStatus = z.enum(['draft', 'open', 'closed', 'cancelled']);
export const ResultsVisibility = z.enum(['always', 'after_close', 'never']);

export const ListPollsQuery = z.object({
  cityId: z.string().uuid(),
  status: PollStatus.optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const CreatePollOptionInput = z.object({
  label: z.string().min(1).max(200),
  sortOrder: z.number().int().min(0).optional(),
});

export const CreatePollInput = z
  .object({
    cityId: z.string().uuid(),
    neighborhoodId: z.string().uuid().optional(),
    title: z.string().min(1).max(200),
    body: z.string().max(10_000).optional(),
    opensAt: z.coerce.date(),
    closesAt: z.coerce.date(),
    resultsVisibility: ResultsVisibility.default('after_close'),
    options: z.array(CreatePollOptionInput).min(2).max(20),
  })
  .refine((d) => d.closesAt.getTime() > d.opensAt.getTime(), {
    message: 'closesAt must be after opensAt',
    path: ['closesAt'],
  });

export const UpdatePollInput = z
  .object({
    title: z.string().min(1).max(200).optional(),
    body: z.string().max(10_000).nullable().optional(),
    neighborhoodId: z.string().uuid().nullable().optional(),
    opensAt: z.coerce.date().optional(),
    closesAt: z.coerce.date().optional(),
    resultsVisibility: ResultsVisibility.optional(),
  })
  .refine(
    (d) => d.opensAt === undefined || d.closesAt === undefined || d.closesAt.getTime() > d.opensAt.getTime(),
    { message: 'closesAt must be after opensAt', path: ['closesAt'] },
  );

export const CastVoteInput = z.object({
  optionId: z.string().uuid(),
});

export const PollIdParam = z.object({ id: z.string().uuid() });

export type ListPollsQuery = z.infer<typeof ListPollsQuery>;
export type CreatePollInput = z.infer<typeof CreatePollInput>;
export type UpdatePollInput = z.infer<typeof UpdatePollInput>;
export type CastVoteInput = z.infer<typeof CastVoteInput>;

// Aliases matching the controller import contract used by TopicsController.
export type ListQuery = ListPollsQuery;
export type CreateBody = CreatePollInput;
export type UpdateBody = UpdatePollInput;
export type VoteBody = CastVoteInput;
