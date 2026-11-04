import { useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Calendar } from '@astryxdesign/core/Calendar';
import { Icon } from '@astryxdesign/core/Icon';
import { Popover } from '@astryxdesign/core/Popover';
import { dayLabel, rangeLabel, weekNumber } from '@clew/calendar/dates';
import { EventCalendar, type HeadingLevel } from './calendar';
import type { AgendaItem } from './week-agenda';

/**
 * The embedded members of the calendar family (D32). None of them imports FullCalendar: they are compositions over
 * `EventCalendar` and Astryx, so D27's "one file imports FullCalendar" holds. Where each may go is part of the contract:
 * `DayStrip` needs 380 px (a LayoutPanel, a Drawer or a Dialog), `EventList` works down to 280 px (a chat bubble on a
 * phone), and the time grid week is the page's alone.
 */
type Shared = { items: AgendaItem[]; label?: string; dayHeadingLevel?: HeadingLevel; accessiblePath?: string; selectedId?: string; onItemClick?: (item: AgendaItem) => void };

/** One day on its hour axis, fitted to its entries: the "day around it" the side panel and the event dialog show. */
export function DayStrip({ date, items, label, dayHeadingLevel = 3, accessiblePath, selectedId, onItemClick }: Shared & { date: string }) {
  return <EventCalendar view="timeGridDay" compact date={date} items={items} label={label ?? dayLabel(date)} dayHeadingLevel={dayHeadingLevel} accessiblePath={accessiblePath} selectedId={selectedId} onItemClick={onItemClick} />;
}

/** The entries of a day or a week as a list with a heading per day: the phone's week and the proposals' week in a chat bubble. */
export function EventList({ from, days = 5, items, label, dayHeadingLevel = 3, accessiblePath, selectedId, onItemClick }: Shared & { from: string; days?: 1 | 5 }) {
  const name = label ?? (days === 1 ? dayLabel(from) : `Vecka ${weekNumber(from)}, ${rangeLabel(from, 5)}`);
  return <EventCalendar view={days === 1 ? 'listDay' : 'listWeek'} compact date={from} items={items} label={name} dayHeadingLevel={dayHeadingLevel} accessiblePath={accessiblePath} selectedId={selectedId} onItemClick={onItemClick} />;
}

/** "Gå till datum": Astryx's month picker in a popover (a bottom sheet under a finger), Monday first, with the ISO week numbers the product speaks in. */
type IsoDate = `${number}${number}${number}${number}-${number}${number}-${number}${number}`;
export function DatePicker({ value, onChange, label = 'Gå till datum', size = 'sm' }: { value: string; onChange: (date: string) => void; label?: string; size?: 'sm' | 'md' }) {
  const [open, setOpen] = useState(false);
  return <Popover label={label} presentation="adaptive" isOpen={open} onOpenChange={setOpen}
    content={<Calendar mode="single" value={value as IsoDate} weekStartsOn="mon" hasWeekNumbers onChange={(next: string | null) => { if (next) { onChange(next); setOpen(false); } }} />}>
    <Button variant="ghost" size={size} label={label} icon={<Icon icon="calendar" size="sm" />} isIconOnly />
  </Popover>;
}
