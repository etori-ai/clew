import type { MenuHint, View } from '@clew/contracts';

/**
 * The declared views of the calendar's reads (D38). Today, the week and a day are drawn by the calendar family itself
 * (D32: `agendaItems()` is the only mapping from events to what is drawn), so they declare none. The rooms are rows
 * like any connector's, drawn by the one renderer, and can be a tool in the menu (D40). A leaf, so the WCAG harness can
 * draw the same declaration without the server.
 */
export const roomsView: View = {
  kind: 'table',
  title: 'name',
  ref: 'ref',
  noun: { one: 'rum', other: 'rum' },
  empty: 'Kalendern känner inga rum.',
  fields: [
    { key: 'name', label: 'Rum' },
    { key: 'capacity', label: 'Platser', format: 'number', unit: { one: 'plats', other: 'platser' } },
    { key: 'equipment', label: 'Utrustning' },
  ],
};
export const roomsMenu: MenuHint = { label: 'Mötesrum', icon: 'people' };
