import type { ViewRef } from '@clew/contracts';

/**
 * The portal's addresses (D67): a card is a page, a view is a page, a conversation is the same route as in the web
 * app so the shared conversation provider finds it. Every value in an address is English (D43).
 */
export const cardHref = (threadId: string, actionId?: string) =>
  `/cards/${encodeURIComponent(threadId)}${actionId ? `?action=${encodeURIComponent(actionId)}` : ''}`;
export const conversationHref = (threadId: string) => `/conversations/${encodeURIComponent(threadId)}`;
export const viewHref = (view: Pick<ViewRef, 'capability' | 'title'> & { input?: Record<string, unknown> }) => {
  const q = new URLSearchParams();
  q.set('title', view.title);
  if (view.input && Object.keys(view.input).length) q.set('input', JSON.stringify(view.input));
  return `/tools/${encodeURIComponent(view.capability)}?${q.toString()}`;
};
export const activitiesHref = (next: { tab?: string; area?: string | null } = {}) => {
  const q = new URLSearchParams();
  if (next.tab && next.tab !== 'needs-you') q.set('tab', next.tab);
  if (next.area) q.set('area', next.area);
  const s = q.toString();
  return s ? `/activities?${s}` : '/activities';
};
