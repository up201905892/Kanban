import { z } from 'zod';

export const LABEL_NAME_MIN_LENGTH = 1;
export const LABEL_NAME_MAX_LENGTH = 30;
/** A card can carry at most this many labels. */
export const CARD_LABELS_MAX = 10;

/** The fixed palette (tokens, not CSS values): the web maps each token to its own colours. */
export const LABEL_COLORS = [
  'red',
  'orange',
  'yellow',
  'green',
  'teal',
  'blue',
  'purple',
  'gray',
] as const;
export const labelColorSchema = z.enum(LABEL_COLORS, {
  error: `Color must be one of: ${LABEL_COLORS.join(', ')}`,
});
export type LabelColor = z.infer<typeof labelColorSchema>;

export const labelNameSchema = z
  .string()
  .trim()
  .min(LABEL_NAME_MIN_LENGTH, 'Name is required')
  .max(LABEL_NAME_MAX_LENGTH, `Name must be at most ${LABEL_NAME_MAX_LENGTH} characters`);

/** Names are unique per project without regard to case; this is the comparison key. */
export const labelNameKey = (name: string): string => name.trim().toLowerCase();

export const projectLabelsParamsSchema = z.strictObject({ pid: z.uuid() });
export const labelParamsSchema = z.strictObject({ id: z.uuid() });

export const labelSchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  name: z.string(),
  color: labelColorSchema,
});
export type Label = z.infer<typeof labelSchema>;

export const labelResponseSchema = z.object({ label: labelSchema });
export type LabelResponse = z.infer<typeof labelResponseSchema>;

export const labelListResponseSchema = z.object({ labels: z.array(labelSchema) });
export type LabelListResponse = z.infer<typeof labelListResponseSchema>;

export const createLabelRequestSchema = z.strictObject({
  /** Client-generated id (A6): repeating the create returns the existing label. */
  id: z.uuid().optional(),
  name: labelNameSchema,
  color: labelColorSchema,
});
export type CreateLabelRequest = z.infer<typeof createLabelRequestSchema>;

export const updateLabelRequestSchema = z
  .strictObject({
    name: labelNameSchema.optional(),
    color: labelColorSchema.optional(),
  })
  .refine((body) => Object.values(body).some((v) => v !== undefined), {
    message: 'Send at least one field to change',
  });
export type UpdateLabelRequest = z.infer<typeof updateLabelRequestSchema>;

/** `PUT /api/cards/:id/labels`: the complete set of labels of the card. */
export const setCardLabelsRequestSchema = z.strictObject({
  labelIds: z
    .array(z.uuid())
    .max(CARD_LABELS_MAX, `A card can have at most ${CARD_LABELS_MAX} labels`)
    .refine((ids) => new Set(ids).size === ids.length, 'Each label can be listed only once'),
});
export type SetCardLabelsRequest = z.infer<typeof setCardLabelsRequestSchema>;

/** The ids to add and to remove to turn `current` into `next` (both treated as sets). */
export function diffLabelIds(
  current: readonly string[],
  next: readonly string[],
): { added: string[]; removed: string[] } {
  const before = new Set(current);
  const after = new Set(next);
  return {
    added: [...after].filter((id) => !before.has(id)),
    removed: [...before].filter((id) => !after.has(id)),
  };
}

/** `labels_changed` payload entry: the name is kept because the label may be deleted later. */
export const labelRefSchema = z.object({ id: z.uuid(), name: z.string() });
