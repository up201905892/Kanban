import type { Label } from '@kanban/shared';
import { labelsOfCard } from './labels';

/** A label: its name is always the text; the colour is only a second cue. */
export function LabelChip({ label }: { label: Pick<Label, 'name' | 'color'> }) {
  return <span className={`label-chip label-${label.color}`}>{label.name}</span>;
}

/** The labels of one tile; nothing when the card has none. */
export function CardLabels({
  labelIds,
  labels,
}: {
  labelIds: readonly string[];
  labels: readonly Label[];
}) {
  if (labelIds.length === 0) return null;
  const shown = labelsOfCard(labelIds, labels);
  if (shown.length === 0) return null;
  return (
    <span className="card-labels" role="list" aria-label="Labels" data-testid="card-labels">
      {shown.map((label) => (
        <span key={label.id} role="listitem">
          <LabelChip label={label} />
        </span>
      ))}
    </span>
  );
}
