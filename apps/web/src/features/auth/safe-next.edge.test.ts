import { loginPathFor, sanitizeNext } from './safe-next';

describe('sanitizeNext edge cases (tester)', () => {
  it.each([
    '/\u0000/evil.example',
    '/\r\n/evil.example',
    '/\u007f//evil.example',
    '///evil.example',
    '/\\/evil.example',
    'https:/evil.example',
    'mailto:a@b.c',
    'vbscript:msgbox(1)',
  ])('rejects %j', (input) => {
    expect(sanitizeNext(input)).toBe('/');
  });

  it('keeps encoded slashes as a path on this origin, never a host', () => {
    const result = sanitizeNext('/%2F%2Fevil.example');
    expect(result.startsWith('/')).toBe(true);
    expect(result.startsWith('//')).toBe(false);
  });

  it('never produces a login URL carrying an unsafe next', () => {
    expect(loginPathFor('https://evil.example')).toBe('/login');
    expect(loginPathFor('javascript:alert(1)')).toBe('/login');
  });
});
