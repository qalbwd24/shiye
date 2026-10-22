import { JSDOM } from 'jsdom';

/** Detached DIV parsing preserves legacy innerHTML semantics without a Window per entry.
 * jsdom's fragment owner document is inert (no browsing context, scripts or resources).
 * Never expose nodes outside the synchronous conversion or retain them in a cache. */
export function legacyReadingRoot(html) {
  const root = JSDOM.fragment('').ownerDocument.createElement('div');
  root.innerHTML = typeof html === 'string' ? html : '';
  return root;
}
