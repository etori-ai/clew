import type { Area, MenuEntry, MenuIcon, SiteHeaderView, SiteMenuLink, SystemMark } from '@clew/contracts';

/**
 * Clew's own lists that stood on Hem for everyone with a source of them, Mina ärenden (D90) and what the person ordered
 * or reported (D123), and that are tools since Hem has no tool tiles and no such blocks (D126 rule 8). A person who has
 * one finds it under Verktyg and on Alla verktyg whether or not an administrator placed it in the menu (D40); placed,
 * the menu's own row stands in its place. The name and the icon are the ones each capability declares for the menu
 * (`modules/errands/capabilities.ts`, `modules/requests/capabilities.ts`), so the row does not change when it is placed.
 * The person has the list when `/api/areas` offers its area, which the server does only for a person with a source.
 */
const OWN_LISTS: ReadonlyArray<{ capability: string; label: string; icon: MenuIcon }> = [
  { capability: 'clew.errands', label: 'Mina ärenden', icon: 'document' },
  { capability: 'clew.requests', label: 'Mina beställningar', icon: 'clock' },
];

const byLabel = (a: MenuEntry, b: MenuEntry) => a.label.localeCompare(b.label, 'sv');

/**
 * Every tool the person may open (D40, D42): the views an administrator placed in the menu, which the server gives only
 * for a person who may call them, and Clew's own lists the person has. In Swedish alphabetical order, as the server
 * orders the menu, so no connector and no operator places a row.
 */
export function toolsOf(menu: readonly MenuEntry[], areas: readonly Area[]): MenuEntry[] {
  const own = OWN_LISTS.flatMap((list): MenuEntry[] => {
    if (menu.some(e => e.capability === list.capability)) return [];
    for (const area of areas) {
      const standing = area.standing.find(s => s.capability === list.capability && s.kind === 'read');
      if (standing)
        return [
          {
            connector: area.connector,
            source: area.source,
            capability: list.capability,
            title: standing.label,
            label: list.label,
            icon: area.icon ?? list.icon,
          },
        ];
    }
    return [];
  });
  return [...menu, ...own].sort(byLabel);
}

/** The tools of one system, under its name on Alla verktyg. */
export interface ToolGroup {
  connector: string;
  source: string;
  tools: MenuEntry[];
}

/**
 * Alla verktyg's sections (D126, the `library` template's grouped sections): the tools by the system they belong to.
 * Clew's own first (the house mark of D71, no ordinal), then the systems in the order the administrator registered them,
 * then any system the person's marks do not list, by name; within a system the tools keep their alphabetical order.
 */
export function toolGroups(tools: readonly MenuEntry[], systems: readonly SystemMark[] = []): ToolGroup[] {
  const groups = new Map<string, ToolGroup>();
  for (const tool of tools) {
    const group = groups.get(tool.connector);
    if (group) group.tools.push(tool);
    else groups.set(tool.connector, { connector: tool.connector, source: tool.source, tools: [tool] });
  }
  const rank = (connector: string) => {
    const mark = systems.find(s => s.connector === connector);
    if (!mark) return Number.MAX_SAFE_INTEGER;
    return mark.ordinal ?? 0;
  };
  return [...groups.values()].sort(
    (a, b) => rank(a.connector) - rank(b.connector) || a.source.localeCompare(b.source, 'sv'),
  );
}

const folded = (text: string) => text.toLocaleLowerCase('sv-SE');
/**
 * The tools whose name, what they are or system holds every word typed, in any case (Alla verktyg's search field narrows
 * in place). Nothing typed is every tool.
 */
export function narrowTools(tools: readonly MenuEntry[], typed: string): MenuEntry[] {
  const words = folded(typed).split(/\s+/).filter(Boolean);
  if (!words.length) return [...tools];
  return tools.filter(tool => {
    const text = folded([tool.label, tool.title, tool.source].join(' '));
    return words.every(word => text.includes(word));
  });
}

/** What a tile says the tool is: the read's own title, when it says more than the tool's name. */
export const whatItIs = (tool: Pick<MenuEntry, 'label' | 'title'>): string | null =>
  folded(tool.title.trim()) === folded(tool.label.trim()) ? null : tool.title;

/**
 * The intranet's page of tools, when the shared header (D88) lists one the installation marked as such (`purpose:
 * 'toolbox'`, D112 amended 2026-11-11): the first in the band's order, a place or a page under one. Null without one:
 * Clew never makes up the address. Alla verktyg links to it at its foot.
 */
export function toolboxPage(header: SiteHeaderView | null | undefined): SiteMenuLink | null {
  for (const place of header?.menu.items ?? []) {
    if (place.purpose === 'toolbox') return place;
    const page = place.children?.find(child => child.purpose === 'toolbox');
    if (page) return page;
  }
  return null;
}
