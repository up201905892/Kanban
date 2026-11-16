/**
 * A message the log-in page shows once the person lands there, for example "Your session expired;
 * 2 pending changes were not saved" (KB-021). It lives outside the router state because the
 * redirect to the log-in page may come from several places.
 */
let notice: string | null = null;

export const setSessionNotice = (message: string | null): void => {
  notice = message;
};

export const getSessionNotice = (): string | null => notice;
