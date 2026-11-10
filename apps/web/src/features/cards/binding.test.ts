import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { applyTextChange, transformPosition } from './binding';

function pair(initial: string) {
  const a = new Y.Doc();
  const b = new Y.Doc();
  a.getText('t').insert(0, initial);
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  return { a, b, ta: a.getText('t'), tb: b.getText('t') };
}

const sync = (a: Y.Doc, b: Y.Doc) => {
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
};

describe('applyTextChange', () => {
  it('turns a typed character into one insert', () => {
    const { ta } = pair('Hello');
    applyTextChange(ta, 'Hello!');
    expect(ta.toString()).toBe('Hello!');
  });

  it('turns a replaced middle into delete plus insert', () => {
    const { ta } = pair('one two three');
    applyTextChange(ta, 'one 2 three');
    expect(ta.toString()).toBe('one 2 three');
  });

  it('merges two people typing in different places of the same text', () => {
    const { a, b, ta, tb } = pair('Start middle end');
    applyTextChange(ta, 'Start! middle end');
    applyTextChange(tb, 'Start middle end.');
    sync(a, b);
    expect(ta.toString()).toBe('Start! middle end.');
    expect(tb.toString()).toBe(ta.toString());
  });

  it('does nothing when the value is unchanged', () => {
    const { a, ta } = pair('same');
    let updates = 0;
    a.on('update', () => (updates += 1));
    applyTextChange(ta, 'same');
    expect(updates).toBe(0);
  });
});

describe('transformPosition', () => {
  it('shifts the caret for text inserted before it, not after it', () => {
    expect(transformPosition([{ insert: 'abc' }, { retain: 5 }], 4)).toBe(7);
    expect(transformPosition([{ retain: 5 }, { insert: 'abc' }], 4)).toBe(4);
  });

  it('does not move a caret that sits exactly at an insertion', () => {
    expect(transformPosition([{ retain: 4 }, { insert: 'abc' }], 4)).toBe(4);
  });

  it('pulls the caret back for text deleted before it', () => {
    expect(transformPosition([{ retain: 1 }, { delete: 2 }], 6)).toBe(4);
  });

  it('clamps at the start of a deleted range that contains the caret', () => {
    expect(transformPosition([{ retain: 2 }, { delete: 10 }], 5)).toBe(2);
  });
});
