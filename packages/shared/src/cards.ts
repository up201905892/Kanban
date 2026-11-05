import { z } from 'zod';

export const CARD_TITLE_MIN_LENGTH = 1;
export const CARD_TITLE_MAX_LENGTH = 200;
export const CARD_DESCRIPTION_MAX_LENGTH = 20_000;

export const cardTitleSchema = z
  .string()
  .trim()
  .min(CARD_TITLE_MIN_LENGTH, 'Title is required')
  .max(CARD_TITLE_MAX_LENGTH, `Title must be at most ${CARD_TITLE_MAX_LENGTH} characters`);

/** Markdown source. Stored as written (not trimmed); rendering never produces raw HTML. */
export const cardDescriptionSchema = z
  .string()
  .max(
    CARD_DESCRIPTION_MAX_LENGTH,
    `Description must be at most ${CARD_DESCRIPTION_MAX_LENGTH} characters`,
  );

export const cardParamsSchema = z.strictObject({ id: z.uuid() });
export const columnCardsParamsSchema = z.strictObject({ cid: z.uuid() });

/** What a board tile needs; the board response carries one per live card. */
export const cardSummarySchema = z.object({
  id: z.uuid(),
  columnId: z.uuid(),
  /** Per-project sequence number; the reference shown to people is `KEY-number`. */
  number: z.number().int().nonnegative(),
  title: z.string(),
  /** Fractional-index key (ADR 0001) inside the column. */
  position: z.string(),
  version: z.number().int().positive(),
});
export type CardSummary = z.infer<typeof cardSummarySchema>;

export const cardSchema = cardSummarySchema.extend({
  boardId: z.uuid(),
  description: z.string(),
  createdById: z.uuid(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Card = z.infer<typeof cardSchema>;

export const cardResponseSchema = z.object({ card: cardSchema });
export type CardResponse = z.infer<typeof cardResponseSchema>;

export const createCardRequestSchema = z.strictObject({
  /** Client-generated id (A6): repeating the create returns the existing card. */
  id: z.uuid().optional(),
  title: cardTitleSchema,
  description: cardDescriptionSchema.optional(),
  /** Without neighbours the card goes to the end of the column (ADR 0001 section 3). */
  afterCardId: z.uuid().nullable().optional(),
  beforeCardId: z.uuid().nullable().optional(),
});
export type CreateCardRequest = z.infer<typeof createCardRequestSchema>;

export const updateCardRequestSchema = z
  .strictObject({
    title: cardTitleSchema.optional(),
    /** Interim: KB-019 moves the description to the Yjs document and removes it from here. */
    description: cardDescriptionSchema.optional(),
  })
  .refine((body) => Object.values(body).some((v) => v !== undefined), {
    message: 'Send at least one field to change',
  });
export type UpdateCardRequest = z.infer<typeof updateCardRequestSchema>;

/** Query string of `DELETE /api/columns/:id`. */
export const deleteColumnQuerySchema = z.strictObject({
  /** Column of the same board that receives the cards of the deleted column. */
  moveCardsTo: z.uuid().optional(),
});
export type DeleteColumnQuery = z.infer<typeof deleteColumnQuerySchema>;

/** `KEY-number`, e.g. `KB-12`. */
export const cardReference = (projectKey: string, number: number): string =>
  `${projectKey}-${number}`;

const columnRefSchema = z.object({ columnId: z.uuid(), columnName: z.string() });

/** Event types recorded for cards (G5). Later tasks add their own variants. */
export const ACTIVITY_TYPES = [
  'created',
  'title_changed',
  'description_changed',
  'deleted',
  'column_deleted_moved',
] as const;

/**
 * Discriminated union of activity events: `type` selects the shape of `data`. Descriptions store
 * lengths, never the text.
 */
export const activityEventDataSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('created'),
    data: z.object({ title: z.string(), column: columnRefSchema }),
  }),
  z.object({
    type: z.literal('title_changed'),
    data: z.object({ from: z.string(), to: z.string() }),
  }),
  z.object({
    type: z.literal('description_changed'),
    data: z.object({ from: z.number().int().nonnegative(), to: z.number().int().nonnegative() }),
  }),
  z.object({ type: z.literal('deleted'), data: z.object({ title: z.string() }) }),
  z.object({
    type: z.literal('column_deleted_moved'),
    data: z.object({ from: columnRefSchema, to: columnRefSchema }),
  }),
]);
export type ActivityEventData = z.infer<typeof activityEventDataSchema>;
export type ActivityType = ActivityEventData['type'];

export const activityEventSchema = z
  .object({
    id: z.uuid(),
    cardId: z.uuid(),
    actorId: z.uuid(),
    createdAt: z.iso.datetime(),
  })
  .and(activityEventDataSchema);
export type ActivityEvent = z.infer<typeof activityEventSchema>;
