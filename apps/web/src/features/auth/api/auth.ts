import {
  authResponseSchema,
  type AuthResponse,
  type LoginRequest,
  type SignupRequest,
  type User,
} from '@kanban/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { apiClient, isApiError } from '../../../lib/api';

export const currentUserKey = ['auth', 'me'] as const;

/** `null` means "not logged in" (a 401 from `/api/auth/me` is a normal answer, not an error). */
async function fetchCurrentUser(signal: AbortSignal): Promise<User | null> {
  try {
    const { user } = await apiClient.get('/api/auth/me', authResponseSchema, signal);
    return user;
  } catch (error) {
    if (isApiError(error) && error.status === 401) return null;
    throw error;
  }
}

export function useCurrentUser() {
  return useQuery({
    queryKey: currentUserKey,
    queryFn: ({ signal }) => fetchCurrentUser(signal),
    staleTime: 60_000,
  });
}

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation<AuthResponse, Error, LoginRequest>({
    mutationFn: (body) => apiClient.post('/api/auth/login', body, authResponseSchema),
    onSuccess: ({ user }) => {
      queryClient.setQueryData(currentUserKey, user);
    },
  });
}

export function useSignup() {
  const queryClient = useQueryClient();
  return useMutation<AuthResponse, Error, SignupRequest>({
    mutationFn: (body) => apiClient.post('/api/auth/signup', body, authResponseSchema),
    onSuccess: ({ user }) => {
      queryClient.setQueryData(currentUserKey, user);
    },
  });
}

/** Logs out and always clears the cache, even when the session had already expired. */
export function useLogout() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return useMutation<void, Error, void>({
    mutationFn: async () => {
      await apiClient.post('/api/auth/logout');
    },
    // A 401 here just means the session was already gone: the result is the same.
    meta: { skipUnauthorizedRedirect: true },
    onSettled: () => {
      queryClient.clear();
      // Mounted observers keep their data after clear(), so state "logged out" explicitly.
      queryClient.setQueryData(currentUserKey, null);
      void navigate('/login');
    },
  });
}
