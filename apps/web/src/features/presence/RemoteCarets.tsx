import { useEffect, useRef, useState, type RefObject } from 'react';
import type * as Y from 'yjs';
import { awarenessStateSchema } from '@kanban/shared';
import type { AwarenessSync } from '../../lib/realtime/awareness-sync';
import { resolveCaret } from '../../lib/realtime/caret';

interface DrawnCaret {
  clientId: number;
  name: string;
  color: string;
  left: number;
  top: number;
  height: number;
}

/** Style properties that decide where text wraps; the mirror copies them from the textarea. */
const MIRRORED = [
  'boxSizing',
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
  'borderStyle',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'fontFamily',
  'fontSize',
  'fontWeight',
  'fontStyle',
  'fontVariant',
  'fontStretch',
  'lineHeight',
  'letterSpacing',
  'wordSpacing',
  'textTransform',
  'textIndent',
  'tabSize',
] as const;

/**
 * Remote carets of the description editor (KB-020). A hidden mirror element copies the textarea's
 * text and styles; the position of a marker at the caret's index in the mirror is where the caret
 * is drawn. The overlay is `aria-hidden`; each caret carries the person's name as visible text, so
 * it is not identified by colour alone. Selections of other people are not drawn.
 */
export function RemoteCarets({
  areaRef,
  text,
  presence,
}: {
  areaRef: RefObject<HTMLTextAreaElement | null>;
  text: Y.Text;
  presence: AwarenessSync;
}) {
  const mirrorRef = useRef<HTMLDivElement>(null);
  const [carets, setCarets] = useState<DrawnCaret[]>([]);

  useEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    const { awareness } = presence;

    const measure = () => {
      const mirror = mirrorRef.current;
      if (!mirror) return;
      const computed = getComputedStyle(area);
      for (const property of MIRRORED) mirror.style[property] = computed[property];
      mirror.style.width = `${area.offsetWidth}px`;
      const lineHeight = Number.parseFloat(computed.lineHeight);
      const height = Number.isFinite(lineHeight)
        ? lineHeight
        : Number.parseFloat(computed.fontSize) * 1.3;
      const source = text.toString();
      const drawn: DrawnCaret[] = [];
      for (const [clientId, raw] of awareness.getStates()) {
        if (clientId === awareness.clientID) continue;
        const state = awarenessStateSchema.safeParse(raw);
        if (!state.success) continue;
        const index = resolveCaret(text, state.data.caret);
        if (index === null) continue;
        mirror.textContent = source.slice(0, index);
        const marker = document.createElement('span');
        marker.textContent = '​';
        mirror.appendChild(marker);
        // Relative to the textarea's own box; the overlay is placed over it by the wrapper.
        const within = marker.offsetTop + area.clientTop - area.scrollTop;
        // Carets scrolled out of the visible part of the textarea are not drawn.
        if (within < -height || within > area.clientHeight) continue;
        const top = within + area.offsetTop;
        const left = marker.offsetLeft + area.clientLeft - area.scrollLeft + area.offsetLeft;
        drawn.push({
          clientId,
          name: state.data.name,
          color: state.data.color,
          left,
          top,
          height,
        });
      }
      setCarets(drawn);
    };

    awareness.on('change', measure);
    text.observe(measure);
    area.addEventListener('scroll', measure);
    window.addEventListener('resize', measure);
    // Carets that were already there when the editor opened.
    queueMicrotask(measure);
    return () => {
      awareness.off('change', measure);
      text.unobserve(measure);
      area.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
    };
  }, [areaRef, text, presence]);

  return (
    <div className="remote-carets" aria-hidden="true" data-testid="remote-carets">
      <div ref={mirrorRef} className="remote-carets-mirror" />
      {carets.map((caret) => (
        <span
          key={caret.clientId}
          className="remote-caret"
          data-testid="remote-caret"
          style={{
            left: caret.left,
            top: caret.top,
            height: caret.height,
          }}
        >
          <span className="remote-caret-label" style={{ background: caret.color }}>
            {caret.name}
          </span>
        </span>
      ))}
    </div>
  );
}
