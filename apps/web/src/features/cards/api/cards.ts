import {
  cardResponseSchema,
  keyBetween,
  type BoardResponse,
  type Card,
  type CardResponse,
  type UpdateCardRequest,
} from '@kanban/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient, request } from '../../../lib/api';
import { boardKey, useBoardMutation } from '../../board/api';
import { cardsOf, placeCard } from '../../board/ordering';

export const cardKey = (id: string) => ['cards', id] as const;

/** The full card (with its description). An empty id means "not known yet". */
export function useCard(id: string) {
  return useQuery({
    queryKey: cardKey(id),
    enabled: id !== '',
    queryFn: async ({ signal }) =>
      (await apiClient.get(`/api/cards/${id}`, cardResponseSchema, signal)).card,
  });
}

export interface CreateCardVars {
  /** Required on the client so a retry repeats the same create (A6). */
  id: string;
  columnId: string;
  title: string;
}

export function useCreateCard(projectId: string) {
  return useBoardMutation<CreateCardVars, CardResponse>(
    projectId,
    ({ columnId, ...body }) =>
      apiClient.post(`/api/columns/${columnId}/cards`, body, cardResponseSchema),
    (board, vars) => {
      if (board.cards.some((c) => c.id === vars.id)) return board;
      const last = cardsOf(board, vars.columnId).at(-1);
      let position = 'zzzz';
      try {
        position = keyBetween(last?.position ?? null, null);
      } catch {
        // Keep the placeholder; the refetch brings the real key.
      }
      // Number 0 marks a card the server has not numbered yet.
      return {
        ...board,
        cards: [
          ...board.cards,
          {
            id: vars.id,
            columnId: vars.columnId,
            number: 0,
            title: vars.title,
            position,
            version: 1,
            assigneeId: null,
            priority: 'none' as const,
            estimate: null,
          },
        ],
      };
    },
  );
}

export interface UpdateCardVars {
  id: string;
  patch: UpdateCardRequest;
}

interface UpdateContext {
  board: BoardResponse | undefined;
  card: Card | undefined;
}

/**
 * Title, assignee, priority and estimate show at once (tile and dialog) and roll back on error.
 * The description is not part of this request: it travels through the Yjs document (KB-019).
 */
export function useUpdateCard(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation<CardResponse, Error, UpdateCardVars, UpdateContext>({
    mutationFn: ({ id, patch }) => apiClient.patch(`/api/cards/${id}`, patch, cardResponseSchema),
    onMutate: async ({ id, patch }) => {
      await queryClient.cancelQueries({ queryKey: boardKey(projectId) });
      await queryClient.cancelQueries({ queryKey: cardKey(id) });
      const context: UpdateContext = {
        board: queryClient.getQueryData<BoardResponse>(boardKey(projectId)),
        card: queryClient.getQueryData<Card>(cardKey(id)),
      };
      // Title and the three card fields show at once; undefined keys are left alone.
      const shown: Partial<Pick<Card, 'title' | 'assigneeId' | 'priority' | 'estimate'>> = {};
      if (patch.title !== undefined) shown.title = patch.title;
      if (patch.assigneeId !== undefined) shown.assigneeId = patch.assigneeId;
      if (patch.priority !== undefined) shown.priority = patch.priority;
      if (patch.estimate !== undefined) shown.estimate = patch.estimate;
      if (Object.keys(shown).length > 0) {
        queryClient.setQueryData<BoardResponse>(
          boardKey(projectId),
          (old) =>
            old && {
              ...old,
              cards: old.cards.map((c) => (c.id === id ? { ...c, ...shown } : c)),
            },
        );
        queryClient.setQueryData<Card>(cardKey(id), (old) => old && { ...old, ...shown });
      }
      return context;
    },
    onSuccess: ({ card }) => {
      queryClient.setQueryData(cardKey(card.id), card);
    },
    onError: (_error, { id }, context) => {
      queryClient.setQueryData(boardKey(projectId), context?.board);
      queryClient.setQueryData(cardKey(id), context?.card);
    },
    onSettled: (_data, _error, { id }) => {
      void queryClient.invalidateQueries({ queryKey: boardKey(projectId) });
      void queryClient.invalidateQueries({ queryKey: cardKey(id) });
    },
  });
}

export interface MoveCardVars {
  id: string;
  columnId: string;
  afterCardId: string | null;
  beforeCardId: string | null;
}

/** Optimistic move: the board shows the card in its new place at once and rolls back on error. */
export function useMoveCard(projectId: string) {
  const queryClient = useQueryClient();
  return useBoardMutation<MoveCardVars, CardResponse>(
    projectId,
    async ({ id, ...body }) => {
      const result = await apiClient.post(`/api/cards/${id}/move`, body, cardResponseSchema);
      // The card dialog may hold an older copy (version, column).
      void queryClient.invalidateQueries({ queryKey: cardKey(id) });
      return result;
    },
    (board, { id, columnId, afterCardId, beforeCardId }) =>
      placeCard(board, id, columnId, afterCardId, beforeCardId),
  );
}

export function useDeleteCard(projectId: string) {
  return useBoardMutation<string, void>(
    projectId,
    async (id) => {
      await request(`/api/cards/${id}`, { method: 'DELETE' });
    },
    (board, id) => ({ ...board, cards: board.cards.filter((c) => c.id !== id) }),
  );
}
