import { z } from 'zod';
import { columnSchema } from './board.js';
import { cardSummarySchema } from './cards.js';

/** Request header a client sets on every mutation so it can recognise the echo of its own change. */
export const CLIENT_MUTATION_HEADER = 'x-client-mutation-id';
export const clientMutationIdSchema = z.uuid();

const baseFields = {
  boardId: z.uuid(),
  /** The user whose request caused the change. */
  actorId: z.uuid(),
  /** The `X-Client-Mutation-Id` of the request, when it sent one. */
  clientMutationId: clientMutationIdSchema.optional(),
  at: z.iso.datetime(),
};

/** Cards carry their new `version`. */
const cardEvent = <T extends string>(type: T) =>
  z.strictObject({
    type: z.literal(type),
    ...baseFields,
    entity: cardSummarySchema,
    version: z.number().int().positive(),
  });

/** Columns are not versioned, so their events carry `version: null` and are always applied. */
const columnEvent = <T extends string>(type: T) =>
  z.strictObject({
    type: z.literal(type),
    ...baseFields,
    entity: columnSchema,
    version: z.null(),
  });

/**
 * A committed change to a board, published to the `board:<id>` room after the transaction commits
 * (KB-018). Card events are applied only when `version` is newer than the one a client holds.
 */
export const boardEventSchema = z.discriminatedUnion('type', [
  columnEvent('column_created'),
  columnEvent('column_updated'),
  z.strictObject({
    type: z.literal('column_deleted'),
    ...baseFields,
    entity: z.strictObject({ id: z.uuid(), name: z.string() }),
    version: z.null(),
  }),
  cardEvent('card_created'),
  /** Title, assignee, priority, estimate or description changed. */
  cardEvent('card_updated'),
  /** Column and/or position changed (also respaced siblings and cards of a deleted column). */
  cardEvent('card_moved'),
  z.strictObject({
    type: z.literal('card_deleted'),
    ...baseFields,
    entity: z.strictObject({
      id: z.uuid(),
      columnId: z.uuid(),
      number: z.number().int().nonnegative(),
      title: z.string(),
    }),
    version: z.number().int().positive(),
  }),
]);
export type BoardEvent = z.infer<typeof boardEventSchema>;
export type BoardEventType = BoardEvent['type'];
