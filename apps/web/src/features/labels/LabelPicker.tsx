import { useId } from 'react';
import { CARD_LABELS_MAX, type Label } from '@kanban/shared';
import { useAnnounce } from '../../components';
import { useSetCardLabels } from './api';
import { LabelChip } from './LabelChip';
import { describeLabelChange, labelsOfCard, sortLabels, toggleLabelId } from './labels';

export interface LabelPickerProps {
  projectId: string;
  cardId: string;
  /** The labels on the card now (from the live board, so remote changes show up here too). */
  labelIds: readonly string[];
  /** Every label of the project. */
  labels: readonly Label[];
  canEdit: boolean;
}

/** Labels of a card in the dialog: a checkbox list for editors (Space toggles), plain text for viewers. */
export function LabelPicker({ projectId, cardId, labelIds, labels, canEdit }: LabelPickerProps) {
  const headingId = useId();
  const announce = useAnnounce();
  const setLabels = useSetCardLabels(projectId);
  const sorted = sortLabels(labels);

  if (!canEdit) {
    const shown = labelsOfCard(labelIds, labels);
    return (
      <section aria-labelledby={headingId}>
        <h3 id={headingId}>Labels</h3>
        {shown.length === 0 ? (
          <p>No labels</p>
        ) : (
          <ul className="label-list">
            {shown.map((label) => (
              <li key={label.id}>
                <LabelChip label={label} />
              </li>
            ))}
          </ul>
        )}
      </section>
    );
  }

  const toggle = (labelId: string, on: boolean) => {
    const next = toggleLabelId(labelIds, labelId, on);
    setLabels.mutate(
      { cardId, labelIds: next },
      {
        onSuccess: () => announce(describeLabelChange(labelIds, next, labels)),
        onError: (e) => announce(`Could not change the labels: ${e.message}`, 'assertive'),
      },
    );
  };

  if (sorted.length === 0) {
    return (
      <section aria-labelledby={headingId}>
        <h3 id={headingId}>Labels</h3>
        <p>No labels in this project yet. Create them in the project settings.</p>
      </section>
    );
  }

  return (
    <fieldset className="label-picker">
      <legend id={headingId}>Labels</legend>
      <p>Up to {CARD_LABELS_MAX} labels per card.</p>
      <ul className="label-list">
        {sorted.map((label) => {
          const checked = labelIds.includes(label.id);
          return (
            <li key={label.id}>
              <label>
                <input
                  type="checkbox"
                  checked={checked}
                  // The limit is enforced by the server too; this only avoids a pointless request.
                  disabled={!checked && labelIds.length >= CARD_LABELS_MAX}
                  onChange={(event) => toggle(label.id, event.target.checked)}
                />{' '}
                <LabelChip label={label} />
              </label>
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}
