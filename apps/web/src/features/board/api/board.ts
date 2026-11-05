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
import { applyColumnUpdate, sortColumns } from '../ordering';

export const boardKey = (projectId: string) => ['projects', projectId, 'board'] as const;

export function useBoard(projectId: string) {
  return useQuery({
    queryKey: boardKey(projectId),
    queryFn: ({ signal }) =>
      apiClient.get(`/api/projects/${projectId}/board`, boardResponseSchema, signal),
  });
}

interface Context {
  previous: BoardResponse | undefined;
}

/**
 * Shared optimistic plumbing: cancel in-flight reads, apply the change at once, restore the previous
 * board if the server refuses and always refetch so the UI matches the server afterwards (U6).
 */
function useBoardMutation<TVars, TResult>(
  projectId: string,
  mutationFn: (vars: TVars) => Promise<TResult>,
  apply: (board: BoardResponse, vars: TVars) => BoardResponse,
) {
  const queryClient = useQueryClient();
  const key = boardKey(projectId);
  return useMutation<TResult, Error, TVars, Context>({
    mutationFn,
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<BoardResponse>(key);
      queryClient.setQueryData<BoardResponse>(key, (old) => old && apply(old, vars));
      return { previous };
    },
    onError: (_error, _vars, context) => {
      queryClient.setQueryData(key, context?.previous);
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

export function useDeleteColumn(projectId: string) {
  return useBoardMutation<string, void>(
    projectId,
    async (id) => {
      await request(`/api/columns/${id}`, { method: 'DELETE' });
    },
    (board, id) => ({ ...board, columns: board.columns.filter((c) => c.id !== id) }),
  );
}
