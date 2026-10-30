import { loginPathFor, sanitizeNext } from './safe-next';

describe('sanitizeNext', () => {
  it.each([
    ['/', '/'],
    ['/projects/1', '/projects/1'],
    ['/projects/1?tab=a&x=1#top', '/projects/1?tab=a&x=1#top'],
  ])('keeps the same-origin path %s', (input, expected) => {
    expect(sanitizeNext(input)).toBe(expected);
  });

  it.each([
    'https://evil.example/phish',
    'http://evil.example',
    '//evil.example',
    '//evil.example/path',
    '/\\evil.example',
    '\\\\evil.example',
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    ' javascript:alert(1)',
    '/\t/evil.example',
    '/\n/evil.example',
    'data:text/html,hi',
    'evil.example',
    'projects/1',
    '',
  ])('rejects %j', (input) => {
    expect(sanitizeNext(input)).toBe('/');
  });

  it('falls back for null and undefined', () => {
    expect(sanitizeNext(null)).toBe('/');
    expect(sanitizeNext(undefined)).toBe('/');
  });
});

describe('loginPathFor', () => {
  it('keeps the path in next, encoded', () => {
    expect(loginPathFor('/projects/1?a=b')).toBe('/login?next=%2Fprojects%2F1%3Fa%3Db');
  });

  it('omits next for the home page and for unsafe values', () => {
    expect(loginPathFor('/')).toBe('/login');
    expect(loginPathFor('//evil.example')).toBe('/login');
  });
});
