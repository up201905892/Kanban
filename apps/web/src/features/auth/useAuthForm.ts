import { useEffect, useRef, useState } from 'react';
import { useAnnounce } from '../../components';
import type { FormFailure } from './form-errors';

/**
 * Shared behaviour of the auth forms: keeps the current failure, announces it assertively and
 * moves focus to the first invalid field (form-level errors are only announced).
 */
export function useAuthForm<K extends string>(order: readonly K[]) {
  const announce = useAnnounce();
  const [failure, setFailure] = useState<FormFailure<K>>({ fields: {} });
  const [attempt, setAttempt] = useState(0);
  const elements = useRef<Partial<Record<K, HTMLInputElement | null>>>({});

  /** Callback ref for the input of field `key`. */
  const registerField = (key: K) => (element: HTMLInputElement | null) => {
    elements.current[key] = element;
  };

  function fail(next: FormFailure<K>) {
    setFailure(next);
    setAttempt((n) => n + 1);
  }

  useEffect(() => {
    if (attempt === 0) return;
    const firstInvalid = order.find((key) => failure.fields[key]);
    if (firstInvalid) {
      elements.current[firstInvalid]?.focus();
      announce(failure.fields[firstInvalid] ?? 'Check the highlighted fields.', 'assertive');
    } else if (failure.form) {
      announce(failure.form, 'assertive');
    }
    // Only react to a new failed attempt, not to every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  return { failure, fail, clear: () => setFailure({ fields: {} }), registerField };
}
