import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { caretToJSON, resolveCaret } from './caret';

function setup(initial: string) {
  const doc = new Y.Doc();
  const text = doc.getText('description');
  text.insert(0, initial);
  return { doc, text };
}

describe('shared carets', () => {
  it('resolves to the index they were made at', () => {
    const { text } = setup('Hello world');
    expect(resolveCaret(text, caretToJSON(text, 6))).toBe(6);
    expect(resolveCaret(text, caretToJSON(text, 0))).toBe(0);
    expect(resolveCaret(text, caretToJSON(text, 11))).toBe(11);
  });

  it('survives a JSON round trip', () => {
    const { text } = setup('Hello world');
    const wire = JSON.parse(JSON.stringify(caretToJSON(text, 6))) as unknown;
    expect(resolveCaret(text, wire)).toBe(6);
  });

  it('stays on the same character after a remote insert before it', () => {
    const { doc, text } = setup('Hello world');
    const caret = caretToJSON(text, 6); // before "w"
    const remote = new Y.Doc();
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc));
    remote.getText('description').insert(0, 'Oh, ');
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(remote));
    expect(text.toString()).toBe('Oh, Hello world');
    expect(resolveCaret(text, caret)).toBe(10);
    expect(text.toString()[10]).toBe('w');
  });

  it('stays put after a remote delete around it and when its character is deleted', () => {
    const { doc, text } = setup('Hello big world');
    const caret = caretToJSON(text, 10); // before "w"
    const remote = new Y.Doc();
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc));
    remote.getText('description').delete(5, 4); // " big"
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(remote));
    expect(text.toString()).toBe('Hello world');
    expect(resolveCaret(text, caret)).toBe(6);

    // Deleting the character the caret points at moves it to where that character was.
    const second = caretToJSON(text, 6);
    text.delete(6, 5);
    expect(resolveCaret(text, second)).toBe(6);
  });

  it('gives null for something that is not a caret', () => {
    const { text } = setup('abc');
    expect(resolveCaret(text, null)).toBeNull();
    expect(resolveCaret(text, 'nope')).toBeNull();
    expect(resolveCaret(text, { garbage: true })).toBeNull();
  });
});
