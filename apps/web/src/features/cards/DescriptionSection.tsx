import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type * as Y from 'yjs';
import { CARD_DESCRIPTION_MAX_LENGTH, type Card } from '@kanban/shared';
import { Button, TextArea, useAnnounce } from '../../components';
import type { AwarenessSync } from '../../lib/realtime/awareness-sync';
import type { DescriptionStatus } from '../../lib/realtime/card-description';
import { caretToJSON } from '../../lib/realtime/caret';
import { useCurrentUser } from '../auth/api/auth';
import { usePresence } from '../presence/PresenceContext';
import { RemoteCarets } from '../presence/RemoteCarets';
import { LOCAL_ORIGIN, applyTextChange, transformPosition } from './binding';
import { Markdown } from './Markdown';
import { useCardDescription } from './useCardDescription';

const STATUS_TEXT: Record<DescriptionStatus, string> = {
  connecting: 'Connecting…',
  saved: 'Saved',
  syncing: 'Syncing…',
  reconnecting: 'Offline: changes are kept and sync when the connection returns',
  unavailable: 'Description unavailable',
};

export interface DescriptionSectionProps {
  card: Card;
  /** Owners and members type; viewers get a read-only editor that still updates live. */
  canEdit: boolean;
}

/**
 * The card description: a Markdown editor bound to the `Y.Text` of the `card:<id>:description`
 * room (KB-019). There is no Save button: every change is sent at once and the status line says
 * "Saved" or "Syncing…". The status is not a live region, so nothing is announced while typing;
 * only a lost connection or refused access is announced (assertively).
 */
export function DescriptionSection({ card, canEdit }: DescriptionSectionProps) {
  const announce = useAnnounce();
  const user = useCurrentUser().data ?? null;
  const self = useMemo(() => (user ? { id: user.id, name: user.name } : null), [user]);
  const { connection, status, synced } = useCardDescription(card.id, self);
  const [preview, setPreview] = useState(false);
  const [value, setValue] = useState(card.description);
  const headingId = useId();
  const text = connection?.text ?? null;

  // Sync problems are announced once each, assertively.
  const announced = useRef<DescriptionStatus | null>(null);
  useEffect(() => {
    if (announced.current === status) return;
    announced.current = status;
    if (status === 'unavailable') {
      announce(
        'Could not sync the description: you no longer have access to this card',
        'assertive',
      );
    } else if (status === 'reconnecting') {
      announce(
        'Connection lost. Description changes are kept and will sync when it returns',
        'assertive',
      );
    }
  }, [status, announce]);

  const live = synced && text !== null;
  const shown = live ? value : card.description;

  return (
    <section aria-labelledby={headingId}>
      <h3 id={headingId}>Description</h3>
      <div role="group" aria-label="Description mode" className="dialog-actions">
        <Button aria-pressed={!preview} onClick={() => setPreview(false)}>
          Edit
        </Button>
        <Button aria-pressed={preview} onClick={() => setPreview(true)}>
          Preview
        </Button>
        <span data-testid="description-status">{STATUS_TEXT[status]}</span>
      </div>
      {preview ? (
        <div aria-label="Description preview" role="group">
          {shown.trim() === '' ? <p>Nothing to preview.</p> : <Markdown source={shown} />}
        </div>
      ) : (
        <Editor
          text={text}
          presence={connection?.presence ?? null}
          live={live}
          fallback={card.description}
          readOnly={!canEdit}
          onValue={setValue}
          length={shown.length}
        />
      )}
    </section>
  );
}

interface EditorProps {
  text: Y.Text | null;
  /** Carets of the other people (and this person's own) travel through it; null when unknown. */
  presence: AwarenessSync | null;
  /** True once the server state arrived: before that the REST text is shown, read-only. */
  live: boolean;
  fallback: string;
  readOnly: boolean;
  onValue: (value: string) => void;
  length: number;
}

function Editor({ text, presence, live, fallback, readOnly, onValue, length }: EditorProps) {
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const { setEditing } = usePresence();
  const canType = live && !readOnly;

  // Leaving the editor (Preview, closing the dialog) ends "editing" even without a blur event.
  useEffect(() => {
    return () => {
      setEditing(false);
      presence?.setLocal({ editing: false, caret: null });
    };
  }, [presence, setEditing]);

  /** Shares where the caret is (as a relative position) and that this person is editing. */
  const share = (blurred = false) => {
    const area = areaRef.current;
    if (!area || !text || !presence || !live) return;
    const focused = !blurred && document.activeElement === area;
    presence.setLocal({
      editing: focused && canType,
      caret: focused ? caretToJSON(text, Math.min(area.selectionStart, text.length)) : null,
    });
    setEditing(focused && canType);
  };

  useLayoutEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    if (!live || !text) {
      area.value = fallback;
      return;
    }
    area.value = text.toString();
    onValue(area.value);
    const observer = (event: Y.YTextEvent, transaction: Y.Transaction) => {
      if (transaction.origin === LOCAL_ORIGIN) return;
      const element = areaRef.current;
      if (!element) return;
      const next = text.toString();
      onValue(next);
      if (document.activeElement === element) {
        // Remote edits keep the caret (and selection) where the person was typing.
        const start = transformPosition(event.delta, element.selectionStart);
        const end = transformPosition(event.delta, element.selectionEnd);
        element.value = next;
        element.setSelectionRange(Math.min(start, next.length), Math.min(end, next.length));
      } else {
        element.value = next;
      }
    };
    text.observe(observer);
    return () => text.unobserve(observer);
    // `fallback` only matters before the first sync.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, live]);

  return (
    <div className="editor-wrap">
      <TextArea
        ref={areaRef}
        label="Description"
        hint={`${length} of ${CARD_DESCRIPTION_MAX_LENGTH} characters`}
        rows={8}
        maxLength={CARD_DESCRIPTION_MAX_LENGTH}
        readOnly={readOnly || !live}
        aria-readonly={readOnly || !live ? true : undefined}
        aria-busy={!live ? true : undefined}
        defaultValue={fallback}
        onFocus={() => share()}
        onBlur={() => share(true)}
        onSelect={() => share()}
        onKeyUp={() => share()}
        onClick={() => share()}
        onInput={(event) => {
          if (!text || !live || readOnly) return;
          const next = event.currentTarget.value;
          if (next.length > CARD_DESCRIPTION_MAX_LENGTH) {
            event.currentTarget.value = text.toString();
            return;
          }
          applyTextChange(text, next);
          onValue(next);
          share();
        }}
      />
      {live && text && presence && (
        <RemoteCarets areaRef={areaRef} text={text} presence={presence} />
      )}
    </div>
  );
}
