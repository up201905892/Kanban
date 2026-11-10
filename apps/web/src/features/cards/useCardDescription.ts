import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  connectCardDescription,
  type DescriptionConnection,
  type DescriptionStatus,
} from '../../lib/realtime/card-description';

export interface CardDescriptionState {
  connection: DescriptionConnection | null;
  status: DescriptionStatus;
  synced: boolean;
}

const NO_CONNECTION: CardDescriptionState = {
  connection: null,
  status: 'connecting',
  synced: false,
};

/**
 * The live description of a card: joins `card:<id>:description` while the component is mounted and
 * leaves on unmount. The Yjs document is the authority; nothing here goes through REST.
 */
export function useCardDescription(cardId: string): CardDescriptionState {
  const [connection, setConnection] = useState<DescriptionConnection | null>(null);

  useEffect(() => {
    const next = connectCardDescription(cardId);
    // The connection is an external resource created here (not in render) and handed to React.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setConnection(next);
    return () => {
      setConnection(null);
      next.destroy();
    };
  }, [cardId]);

  const snapshot = useSyncExternalStore(
    (listener) => connection?.subscribe(listener) ?? (() => {}),
    () => (connection ? `${connection.status}|${connection.synced}` : ''),
  );

  if (!connection) return NO_CONNECTION;
  const [status, synced] = snapshot.split('|');
  return {
    connection,
    status: (status ?? 'connecting') as DescriptionStatus,
    synced: synced === 'true',
  };
}
