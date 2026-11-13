import { createContext, useContext } from 'react';
import type { PresentPerson } from './view-model';

export interface PresenceContextValue {
  /** Everyone on the board right now, the current user included. */
  people: PresentPerson[];
  /** The open card dialog tells the board which card this person has open. */
  setActiveCard(cardId: string | null): void;
  /** The description editor tells the board whether this person is typing in it. */
  setEditing(editing: boolean): void;
}

const NONE: PresenceContextValue = {
  people: [],
  setActiveCard: () => {},
  setEditing: () => {},
};

export const PresenceContext = createContext<PresenceContextValue>(NONE);

/** Presence of the board the component is on; empty and inert outside a board. */
export const usePresence = (): PresenceContextValue => useContext(PresenceContext);
