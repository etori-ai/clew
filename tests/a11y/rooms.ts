import type { CalendarRoom, MenuEntry, PanelViewSpec } from '@clew/contracts';
import { roomsMenu, roomsView } from '../../apps/server/src/modules/calendar/views';

/**
 * The calendar's rooms as the server answers `calendar.rooms` (D69, amended): the rows the development stack's rooms
 * give, and the view the calendar connector really declares, so the suite draws the declaration and not a copy of it.
 */
export const rooms: CalendarRoom[] = [
  { ref: 'room:granen', name: 'Granen', capacity: 2, equipment: ['skärm'] },
  { ref: 'room:aspen', name: 'Aspen', capacity: 4, equipment: ['skärm', 'video'] },
  { ref: 'room:eken', name: 'Eken', capacity: 6, equipment: ['whiteboard'] },
  { ref: 'room:linden', name: 'Linden', capacity: 8, equipment: ['whiteboard', 'video', 'rullstolsanpassat'] },
  { ref: 'room:tallen', name: 'Tallen', capacity: 12, equipment: ['whiteboard', 'projektor', 'video'] },
  {
    ref: 'room:boken',
    name: 'Boken',
    capacity: 20,
    equipment: ['projektor', 'mikrofon', 'hörslinga', 'rullstolsanpassat'],
  },
  {
    ref: 'room:almen',
    name: 'Almen',
    capacity: 40,
    equipment: ['projektor', 'mikrofon', 'hörslinga', 'video', 'rullstolsanpassat'],
  },
];
/** What the registry adds for the browser: whose view it is; the calendar is no search source, so a row is no chip. */
export const roomsSpec: PanelViewSpec = {
  ...roomsView,
  capability: 'calendar.rooms',
  connector: 'calendar',
  source: 'Kalendern',
  chip: false,
};
/** The rooms as a row in the menu (D40), as the server hands it over once an administrator has chosen it. */
export const roomsMenuRow: MenuEntry = {
  connector: 'calendar',
  source: 'Kalendern',
  capability: 'calendar.rooms',
  title: 'Mötesrum',
  label: roomsMenu.label,
  icon: roomsMenu.icon,
};
