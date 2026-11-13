import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';
import type { BoardEvent, BoardResponse, Card } from '@kanban/shared';
import { isOwnMutation } from '../../lib/api';
import {
  createAwarenessSync,
  type AwarenessSync,
  type LocalPresence,
} from '../../lib/realtime/awareness-sync';
import { connectBoardSocket } from '../../lib/realtime/board-socket';
import type { PresenceContextValue } from '../presence/PresenceContext';
import { toPresentPeople, type PresentPerson } from '../presence/view-model';
import { cardKey } from '../cards/api';
import { boardKey } from './api';
import { applyBoardEvent, applyCardEvent, remoteChangeOf, type RemoteChange } from './board-events';

export interface RemoteChangeContext {
  change: RemoteChange;
  /** The board before and after the event was applied. */
  before: BoardResponse;
  after: BoardResponse;
}

/**
 * Keeps the cached board (and the open card) in step with what other people do (KB-018): joins the
 * `board:<id>` room, applies each event to the TanStack Query cache, skips stale or duplicate events
 * (version check) and the echo of this tab's own mutations, and refetches the board on every
 * (re)connection to cover events missed meanwhile. `onRemoteChange` is told about remote moves and
 * deletions so the view can announce them. An empty `boardId` means "board not loaded yet".
 */
export function useBoardEvents(
  projectId: string,
  boardId: string,
  onRemoteChange?: (context: RemoteChangeContext) => void,
  self?: { id: string; name: string } | null,
): PresenceContextValue {
  const queryClient = useQueryClient();
  const callback = useRef(onRemoteChange);
  useEffect(() => {
    callback.current = onRemoteChange;
  });

  // Presence (KB-020) rides on the same socket: awareness messages of the `board:<id>` room.
  const selfId = self?.id ?? null;
  const selfName = self?.name ?? '';
  const [people, setPeople] = useState<PresentPerson[]>([]);
  const sync = useRef<AwarenessSync | null>(null);
  const local = useRef<Pick<LocalPresence, 'activeCardId' | 'editing'>>({
    activeCardId: null,
    editing: false,
  });
  const setActiveCard = useCallback((cardId: string | null) => {
    local.current.activeCardId = cardId;
    if (cardId === null) local.current.editing = false;
    sync.current?.setLocal({ ...local.current });
  }, []);
  const setEditing = useCallback((editing: boolean) => {
    local.current.editing = editing;
    sync.current?.setLocal({ ...local.current });
  }, []);

  useEffect(() => {
    if (boardId === '') return;
    const key = boardKey(projectId);
    let presence: AwarenessSync | undefined;
    let stopPresence = () => {};
    if (selfId !== null) {
      const awareness = new Awareness(new Y.Doc());
      const refresh = () => setPeople(toPresentPeople(awareness.getStates(), selfId));
      awareness.on('change', refresh);
      presence = createAwarenessSync(awareness, { id: selfId, name: selfName });
      presence.setLocal({ ...local.current });
      sync.current = presence;
      const created = presence;
      stopPresence = () => {
        sync.current = null;
        created.destroy();
        setPeople([]);
      };
    }

    const handle = (event: BoardEvent) => {
      if (isOwnMutation(event.clientMutationId)) return;
      const before = queryClient.getQueryData<BoardResponse>(key);
      if (!before) return;
      const after = applyBoardEvent(before, event);
      if (after !== before) {
        queryClient.setQueryData<BoardResponse>(key, after);
        const change = remoteChangeOf(before, event);
        if (change) callback.current?.({ change, before, after });
      }
      if (event.type === 'card_created' || event.type === 'card_updated') {
        const cached = queryClient.getQueryData<Card>(cardKey(event.entity.id));
        if (cached) {
          // In place now; the refetch brings the description, which the event does not carry.
          queryClient.setQueryData<Card>(cardKey(cached.id), applyCardEvent(cached, event));
          void queryClient.invalidateQueries({ queryKey: cardKey(cached.id), exact: true });
        }
      } else if (event.type === 'card_moved') {
        const cached = queryClient.getQueryData<Card>(cardKey(event.entity.id));
        if (cached) {
          queryClient.setQueryData<Card>(cardKey(cached.id), applyCardEvent(cached, event));
        }
      }
    };

    const close = connectBoardSocket({
      boardId,
      onEvent: handle,
      onConnected: () => {
        void queryClient.invalidateQueries({ queryKey: key });
        void queryClient.invalidateQueries({ queryKey: ['cards'] });
      },
      presence,
    });
    return () => {
      // The removal of our presence goes out before the socket closes.
      stopPresence();
      close();
    };
  }, [queryClient, projectId, boardId, selfId, selfName]);

  return useMemo(
    () => ({ people, setActiveCard, setEditing }),
    [people, setActiveCard, setEditing],
  );
}
