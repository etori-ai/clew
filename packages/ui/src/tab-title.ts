/**
 * A view's name in the browser tab (2.4.2): the view's own name, then the site's. Every tab title is made here, the
 * pages' (`page-title.ts` in the web app) and the session's end (`session.tsx`). The site's name is still written into
 * the code (WA-L6 of the review of 2026-11-23): the installation's name belongs here.
 */
export const tabTitle = (title: string) => `${title} · Startsidan`;
