import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

export type AnnouncePriority = 'polite' | 'assertive';
export type Announce = (message: string, priority?: AnnouncePriority) => void;

const AnnounceContext = createContext<Announce | null>(null);

/** Renders the polite and assertive live regions and provides `useAnnounce()`. */
export function AnnouncerProvider({ children }: { children: ReactNode }) {
  const [polite, setPolite] = useState('');
  const [assertive, setAssertive] = useState('');
  const timers = useRef<number[]>([]);

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((timer) => window.clearTimeout(timer));
  }, []);

  const announce = useCallback<Announce>((message, priority = 'polite') => {
    const set = priority === 'assertive' ? setAssertive : setPolite;
    // Clear first so repeating the same message is announced again.
    set('');
    timers.current.push(window.setTimeout(() => set(message), 50));
  }, []);

  return (
    <AnnounceContext.Provider value={announce}>
      {children}
      <div className="sr-only" data-testid="live-polite" role="status" aria-live="polite">
        {polite}
      </div>
      <div className="sr-only" data-testid="live-assertive" role="alert" aria-live="assertive">
        {assertive}
      </div>
    </AnnounceContext.Provider>
  );
}

export function useAnnounce(): Announce {
  const announce = useContext(AnnounceContext);
  if (!announce) throw new Error('useAnnounce must be used inside <AnnouncerProvider>');
  return announce;
}
