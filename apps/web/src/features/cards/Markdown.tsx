import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import type { Components } from 'react-markdown';

/**
 * Only http, https, irc, ircs, mailto, xmpp and relative addresses survive; `javascript:`, `data:`
 * and similar (also with control characters or odd casing) become an empty string.
 */
export const safeUrl = (url: string): string => defaultUrlTransform(url);

const components: Components = {
  // A link whose address was removed is shown as plain text, not as a dead link.
  a: ({ href, children }) =>
    href ? (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    ) : (
      <span>{children}</span>
    ),
  // Images would load remote content; keep the alt text only.
  img: ({ alt }) => <span>{alt}</span>,
};

/**
 * Renders Markdown without ever producing raw HTML: react-markdown ignores HTML in the source
 * (no `rehype-raw`), so tags such as `<script>` or `<img onerror>` stay inert text.
 */
export function Markdown({ source }: { source: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown urlTransform={safeUrl} components={components} skipHtml>
        {source}
      </ReactMarkdown>
    </div>
  );
}
