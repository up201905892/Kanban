import { initialsOf } from '../cards/fields';
import { peopleListLabel, type PresentPerson } from './view-model';

/** Avatars shown before the rest collapse into "+N". */
export const MAX_AVATARS = 5;

/**
 * Who is on the board: up to five avatars (initials on the person's colour) and "+N". The list's
 * accessible name carries every name ("3 people on this board: ..."); nothing is announced when
 * people come and go.
 */
export function PresenceList({ people }: { people: PresentPerson[] }) {
  if (people.length === 0) return null;
  const shown = people.slice(0, MAX_AVATARS);
  const more = people.length - shown.length;
  return (
    <ul className="presence-list" aria-label={peopleListLabel(people)}>
      {shown.map((person) => (
        <li key={person.userId} className="presence-item" title={person.name}>
          <span className="presence-avatar" style={{ background: person.color }} aria-hidden="true">
            {initialsOf(person.name)}
          </span>
          <span className="sr-only">{person.isSelf ? `${person.name} (you)` : person.name}</span>
        </li>
      ))}
      {more > 0 && (
        <li className="presence-item">
          <span className="presence-more" aria-hidden="true">
            +{more}
          </span>
          <span className="sr-only">{`and ${more} more`}</span>
        </li>
      )}
    </ul>
  );
}
