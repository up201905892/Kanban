import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';

export interface ColumnMenuItem {
  label: string;
  onSelect: () => void;
  /** Explains why the item cannot be used; the item stays visible but does nothing. */
  disabledReason?: string;
}

export interface ColumnMenuProps {
  /** Unique DOM id of the trigger button (the board refocuses it after a move). */
  triggerId: string;
  columnName: string;
  items: ColumnMenuItem[];
}

/**
 * Menu button: Enter/Space/ArrowDown on the trigger opens it, arrows/Home/End move, Enter or Space
 * activates, Escape closes and returns focus to the trigger, Tab closes.
 */
export function ColumnMenu({ triggerId, columnName, items }: ColumnMenuProps) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const focusItem = (index: number) => {
    const nodes = menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]');
    if (!nodes || nodes.length === 0) return;
    nodes[(index + nodes.length) % nodes.length]?.focus();
  };

  useEffect(() => {
    if (open) focusItem(0);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const close = (returnFocus: boolean) => {
    if (returnFocus) triggerRef.current?.focus();
    setOpen(false);
  };

  function onMenuKeyDown(event: KeyboardEvent<HTMLUListElement>) {
    const nodes = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [],
    );
    const current = nodes.indexOf(document.activeElement as HTMLElement);
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        focusItem(current + 1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        focusItem(current - 1);
        break;
      case 'Home':
        event.preventDefault();
        focusItem(0);
        break;
      case 'End':
        event.preventDefault();
        focusItem(nodes.length - 1);
        break;
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        close(true);
        break;
      case 'Tab':
        setOpen(false);
        break;
      default:
    }
  }

  return (
    <div className="column-menu" ref={rootRef}>
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`Actions for column ${columnName}`}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span aria-hidden="true">...</span>
      </button>
      {open && (
        <ul
          id={menuId}
          ref={menuRef}
          role="menu"
          aria-label={`Actions for column ${columnName}`}
          className="menu"
          onKeyDown={onMenuKeyDown}
        >
          {items.map((item) => (
            <li key={item.label} role="none">
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                aria-disabled={item.disabledReason ? true : undefined}
                title={item.disabledReason}
                onClick={() => {
                  if (item.disabledReason) return;
                  // Focus goes back to the trigger first so dialogs and moves restore it correctly.
                  close(true);
                  item.onSelect();
                }}
              >
                {item.label}
                {item.disabledReason && <span className="sr-only"> ({item.disabledReason})</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
