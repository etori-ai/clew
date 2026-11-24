/**
 * A view's name in the browser tab (2.4.2): the view's own name, then the installation's (D98, the appearance's
 * `name`). Every tab title is made here, the pages' (`page-title.ts` in the web app) and the session's end
 * (`session.tsx`).
 */
export const tabTitle = (title: string, site: string) => `${title} · ${site}`;
