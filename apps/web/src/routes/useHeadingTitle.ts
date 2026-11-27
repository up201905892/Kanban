import { APP_NAME } from '@kanban/shared';
import { useEffect } from 'react';

/**
 * WCAG 2.4.2 Page Titled: keeps `document.title` equal to "<page h1> - Kanban", so each route
 * has a title that says what it is. Pages render their `h1` after their data arrives, hence the
 * observer instead of a single read.
 */
export function useHeadingTitle(root: React.RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const update = () => {
      const heading = element.querySelector('h1')?.textContent?.trim();
      document.title = heading ? `${heading} - ${APP_NAME}` : APP_NAME;
    };
    update();
    const observer = new MutationObserver(update);
    observer.observe(element, { subtree: true, childList: true, characterData: true });
    return () => observer.disconnect();
  }, [root]);
}
