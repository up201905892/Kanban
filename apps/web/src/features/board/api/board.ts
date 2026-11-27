import {
  boardResponseSchema,
  columnResponseSchema,
  keyBetween,
  type BoardResponse,
  type ColumnResponse,
  type CreateColumnRequest,
  type UpdateColumnRequest,
} from '@kanban/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient, request } from '../../../lib/api';
import { mergeFetchedBoard } from '../board-events';
import { applyColumnDelete, applyColumnUpdate, sortColumns } from '../ordering';
import { filterTombstoned, tombstoneColumn, tombstonesOf } from '../tombstones';

export const boardKey = (projectId: string) => ['projects', projectId, 'board'] as const;

export function useBoard(projectId: string) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: boardKey(projectId),
    // A refetch that started before a deletion must not bring the card or column back (KB-039).
    // A response older than an event already applied must not undo it either (card `version`).
    queryFn: async ({ signal }) =>
      mergeFetchedBoard(
        filterTombstoned(
          await apiClient.get(`/api/projects/${projectId}/board`, boardResponseSchema, signal),
          tombstonesOf(queryClient),
        ),
        queryClient.getQueryData<BoardResponse>(boardKey(projectId)),
      ),
  });
}

/** Mutations of one project's board run one at a time, in order (also when replayed). */
export const boardScope = (projectId: string) => `project:${projectId}:board`;

interface Context {
  previous: BoardResponse | undefined;
}

/**
 * Shared optimistic plumbing: cancel in-flight reads, apply the change at once, restore the previous
 * board if the server refuses and always refetch so the UI matches the server afterwards (U6).
 */
export function useBoardMutation<TVars, TResult>(
  projectId: string,
  mutationFn: (vars: TVars) => Promise<TResult>,
  apply: (board: BoardResponse, vars: TVars) => BoardResponse,
) {
  const queryClient = useQueryClient();
  const key = boardKey(projectId);
  return useMutation<TResult, Error, TVars, Context>({
    mutationFn,
    // Offline (KB-021) mutations pause (network mode "online") and replay in the order they were
    // made: a shared scope runs the mutations of one project one after another.
    scope: { id: boardScope(projectId) },
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<BoardResponse>(key);
      queryClient.setQueryData<BoardResponse>(key, (old) => old && apply(old, vars));
      return { previous };
    },
    onError: (_error, _vars, context) => {
      // The rollback must not restore a card or column that turned out to be deleted (KB-039).
      queryClient.setQueryData(
        key,
        context?.previous && filterTombstoned(context.previous, tombstonesOf(queryClient)),
      );
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });
}

export interface CreateColumnVars extends CreateColumnRequest {
  /** Required on the client so a retry repeats the same create (A6). */
  id: string;
}

export function useCreateColumn(projectId: string, boardId: string) {
  return useBoardMutation<CreateColumnVars, ColumnResponse>(
    projectId,
    (vars) => apiClient.post(`/api/boards/${boardId}/columns`, vars, columnResponseSchema),
    (board, vars) => {
      if (board.columns.some((c) => c.id === vars.id)) return board;
      const last = sortColumns(board.columns).at(-1);
      let position = 'zzzz';
      try {
        position = keyBetween(last?.position ?? null, null);
      } catch {
        // Keep the placeholder; the refetch brings the real key.
      }
      return {
        ...board,
        columns: [
          ...board.columns,
          { id: vars.id, boardId, name: vars.name, position, isDone: false },
        ],
      };
    },
  );
}

export interface UpdateColumnVars {
  id: string;
  patch: UpdateColumnRequest;
}

export function useUpdateColumn(projectId: string) {
  return useBoardMutation<UpdateColumnVars, ColumnResponse>(
    projectId,
    ({ id, patch }) => apiClient.patch(`/api/columns/${id}`, patch, columnResponseSchema),
    (board, { id, patch }) => applyColumnUpdate(board, id, patch),
  );
}

export interface DeleteColumnVars {
  id: string;
  /** Column that receives the cards; required by the server when the column has cards. */
  moveCardsTo?: string;
}

export function useDeleteColumn(projectId: string) {
  const queryClient = useQueryClient();
  return useBoardMutation<DeleteColumnVars, void>(
    projectId,
    async ({ id, moveCardsTo }) => {
      const query = moveCardsTo ? `?moveCardsTo=${encodeURIComponent(moveCardsTo)}` : '';
      await request(`/api/columns/${id}${query}`, { method: 'DELETE' });
      tombstoneColumn(queryClient, id);
    },
    (board, { id, moveCardsTo }) => applyColumnDelete(board, id, moveCardsTo),
  );
}
