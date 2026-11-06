import { render, screen } from '@testing-library/react';
import { Markdown, safeUrl } from './Markdown';

describe('Markdown', () => {
  it('renders common Markdown', () => {
    render(
      <Markdown source={'# Title\n\nSome **bold** text and a [link](https://example.com).'} />,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Title' })).toBeVisible();
    expect(screen.getByText('bold').tagName).toBe('STRONG');
    const link = screen.getByRole('link', { name: 'link' });
    expect(link).toHaveAttribute('href', 'https://example.com');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('strips <script> elements', () => {
    const { container } = render(<Markdown source={'Hello <script>alert(1)</script> world'} />);
    expect(container.querySelector('script')).toBeNull();
    expect(container.innerHTML).not.toContain('<script');
  });

  it('strips inline event handlers and raw HTML tags', () => {
    const { container } = render(
      <Markdown
        source={
          '<img src=x onerror="alert(1)">\n\n<a href="#" onclick="alert(2)">x</a>\n\n<div onmouseover="alert(3)">y</div>'
        }
      />,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('.markdown div')).toBeNull();
    expect(container.querySelector('.markdown a')).toBeNull();
    for (const element of container.querySelectorAll('*')) {
      for (const attribute of element.getAttributeNames()) {
        expect(attribute.startsWith('on')).toBe(false);
      }
    }
  });

  it('removes javascript: links but keeps their text', () => {
    const { container } = render(
      <Markdown
        source={'[click](javascript:alert(1)) [odd](JaVa\tScRiPt:alert(2)) [safe](/path)'}
      />,
    );
    expect(container.querySelectorAll('a')).toHaveLength(1);
    expect(container.querySelector('a')).toHaveAttribute('href', '/path');
    expect(screen.getByText('click')).toBeVisible();
    expect(container.innerHTML.toLowerCase()).not.toContain('javascript:');
  });

  it('does not load images', () => {
    const { container } = render(<Markdown source={'![logo](https://example.com/x.png)'} />);
    expect(container.querySelector('img')).toBeNull();
  });
});

describe('safeUrl', () => {
  it.each([
    ['https://example.com/a?b=1', 'https://example.com/a?b=1'],
    ['mailto:a@b.co', 'mailto:a@b.co'],
    ['/relative', '/relative'],
    ['javascript:alert(1)', ''],
    ['data:text/html,x', ''],
    ['vbscript:x', ''],
  ])('%s', (input, expected) => {
    expect(safeUrl(input)).toBe(expected);
  });
});
