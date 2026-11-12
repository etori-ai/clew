import { useSyncExternalStore } from 'react';
import type { AskValues } from '@clew/contracts';
import type { ActionStep } from './action-path';

/**
 * Asking a work item to open one of its actions in the action dialog (D112 item 10) from outside the item: an execute
 * started from a person, a unit or Personal's row menu opens its work item beside the page and its dialog over it (D111
 * rule 4), and an assistant's draft opens the dialog at a given step with the values it filled in (D112 item 8). The
 * item takes the request once, when it is drawn with that action; nothing is kept in the address, so a reload never
 * greets the person with a dialog they did not ask for.
 */
export interface ActionRequest {
  threadId: string;
  actionId: string;
  /** The step to open at; without it the dialog chooses (`firstStep`). */
  startAt?: ActionStep;
  /** Values filled in elsewhere, laid over what the person typed on this item before. */
  values?: AskValues;
}
let pending: ActionRequest | null = null;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
/** Ask the work item `threadId` to open `actionId` in the dialog as soon as it is drawn. A later request replaces it. */
export function requestAction(request: ActionRequest): void {
  pending = request;
  listeners.forEach(listener => listener());
}
/** The request waiting for this work item, if any. */
export const useActionRequest = (threadId: string): ActionRequest | null =>
  useSyncExternalStore(subscribe, () => (pending?.threadId === threadId ? pending : null));
/** Take the request: the item opens its dialog once. */
export function takeActionRequest(request: ActionRequest): void {
  if (pending === request) pending = null;
}
