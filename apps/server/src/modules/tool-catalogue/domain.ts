import type { MenuEntry } from '@clew/contracts';

/**
 * Alla verktyg as a read (D141 rule 4), the pure part: the tools a person has, as the page lists them
 * (`apps/web/src/tool-catalogue.ts`, `toolsOf`): the views an administrator placed in the menu that the person may
 * call (D40), then Clew's own lists the person has and that are not placed, in Swedish alphabetical order by name.
 */

/** One tool as the model and the view read it: its name, what it is when that says more, its system and its address. */
export interface ToolRow {
  name: string;
  what?: string;
  system: string;
  /** Where the tool's page is inside Clew: `/tools/<capability>`, the address every tile and rail row leads to. */
  address: string;
}
/** A tool's page inside Clew (D42, D116), as the browser's `toolHref` writes it without a way back. */
export const toolAddress = (capability: string) => `/tools/${encodeURIComponent(capability)}`;
const folded = (text: string) => text.trim().toLocaleLowerCase('sv-SE');
/** What a tool is: the read's own title, when it says more than the tool's name (`whatItIs` on the page). */
const whatItIs = (tool: Pick<MenuEntry, 'label' | 'title'>) =>
  folded(tool.title) === folded(tool.label) ? undefined : tool.title;
/** The tools: every menu row, then each own list not already placed in the menu, by name in Swedish order. */
export function toolRows(menu: readonly MenuEntry[], own: readonly MenuEntry[]): ToolRow[] {
  const placed = new Set(menu.map(e => e.capability));
  return [...menu, ...own.filter(e => !placed.has(e.capability))]
    .sort((a, b) => a.label.localeCompare(b.label, 'sv') || a.capability.localeCompare(b.capability))
    .map(tool => {
      const what = whatItIs(tool);
      return {
        name: tool.label,
        ...(what ? { what } : {}),
        system: tool.source,
        address: toolAddress(tool.capability),
      };
    });
}
