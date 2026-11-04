import type { PluginInput } from '@fullcalendar/react';
import { joinClassNames } from '@fullcalendar/react';

/**
 * Clew's FullCalendar theme (D27): one class-name prop per calendar element, resolved in `calendar-theme.css` to
 * Astryx tokens and nothing else. No stock theme, no palette, no hex. The shape follows FullCalendar's own stock
 * themes (a plugin whose `optionDefaults` and per-view `views` carry the class names), so an upgrade of FullCalendar
 * is a diff against this one file. Toolbar classes are set for completeness; Clew keeps `headerToolbar` off and
 * renders its own Astryx toolbar.
 */

const focusable = 'clew-cal-focusable';
const pressable = 'clew-cal-pressable';

/** The kind of thing an event is, carried in `extendedProps.kind`: a meeting that exists, a drawn proposal or a booked samtal. */
export type CalendarEventKind = 'event' | 'proposal' | 'booked';

const kindClass = (kind: unknown) => `clew-cal-event-${typeof kind === 'string' ? kind : 'event'}`;

const dayRowCommon = {
  rowEventClass: (info: { isStart: boolean; isEnd: boolean; isNarrow: boolean }) =>
    joinClassNames('clew-cal-row-event', info.isStart && 'clew-cal-row-event-start', info.isEnd && 'clew-cal-row-event-end', info.isNarrow && 'clew-cal-narrow'),
  rowEventInnerClass: 'clew-cal-row-event-inner',
  rowEventTimeClass: 'clew-cal-row-event-time',
  rowEventTitleClass: 'clew-cal-row-event-title',
  rowMoreLinkClass: `clew-cal-row-more-link ${pressable} ${focusable}`,
  rowMoreLinkInnerClass: 'clew-cal-row-more-link-inner',
  listItemEventClass: (info: { isNarrow: boolean; isInteractive: boolean; isSelected: boolean }) =>
    joinClassNames('clew-cal-dot-event', info.isNarrow && 'clew-cal-narrow', info.isInteractive && pressable, info.isSelected && 'clew-cal-selected'),
  listItemEventBeforeClass: 'clew-cal-dot-event-dot',
  listItemEventInnerClass: 'clew-cal-dot-event-inner',
  listItemEventTimeClass: 'clew-cal-dot-event-time',
  listItemEventTitleClass: 'clew-cal-dot-event-title',
};

export const clewCalendarTheme: PluginInput & { views: Record<string, Record<string, unknown>> } = {
  name: 'theme-clew',
  optionDefaults: {
    className: 'clew-cal',
    viewClass: (info: { options: { headerToolbar?: unknown; footerToolbar?: unknown }; borderlessX: boolean; borderlessTop: boolean; borderlessBottom: boolean; isHeightAuto: boolean }) => joinClassNames(
      'clew-cal-view',
      !info.borderlessTop && !info.options.headerToolbar && 'clew-cal-view-top',
      !info.borderlessBottom && !info.options.footerToolbar && 'clew-cal-view-bottom',
      !info.borderlessX && 'clew-cal-view-x',
      !info.isHeightAuto && 'clew-cal-view-fixed',
    ),

    /* Toolbar (unused by Clew: the toolbar is Astryx; kept so a plain FullCalendar still looks right) */
    toolbarClass: 'clew-cal-toolbar',
    toolbarSectionClass: 'clew-cal-toolbar-section',
    toolbarTitleClass: 'clew-cal-toolbar-title',
    buttonGroupClass: 'clew-cal-button-group',
    buttonClass: (info: { isSelected: boolean; isPrimary: boolean; isIconOnly: boolean }) =>
      joinClassNames('clew-cal-button', pressable, focusable, info.isSelected && 'clew-cal-button-selected', info.isPrimary && 'clew-cal-button-primary', info.isIconOnly && 'clew-cal-button-icon'),

    /* Events. The colour tokens come from the kind, never from a per-event colour. */
    eventShortHeight: 40,
    eventColor: 'var(--color-background-muted)',
    eventContrastColor: 'var(--color-text-primary)',
    eventClass: (info: { event: { extendedProps: Record<string, unknown> }; isSelected: boolean; isDragging: boolean; isMirror: boolean; isInteractive: boolean; isPast: boolean }) => joinClassNames(
      'clew-cal-event', kindClass(info.event.extendedProps.kind), focusable,
      info.isInteractive && pressable, (info.isSelected || info.event.extendedProps.selected === true) && 'clew-cal-selected', info.isDragging && 'clew-cal-dragging', info.isMirror && 'clew-cal-mirror', info.isPast && 'clew-cal-past',
    ),
    backgroundEventClass: 'clew-cal-background-event',
    backgroundEventTitleClass: 'clew-cal-background-event-title',
    blockEventClass: 'clew-cal-block-event',
    blockEventInnerClass: 'clew-cal-block-event-inner',
    blockEventTimeClass: 'clew-cal-block-event-time',
    blockEventTitleClass: 'clew-cal-block-event-title',
    columnEventTitleSticky: false,
    columnEventClass: (info: { isStart: boolean; isEnd: boolean }) =>
      joinClassNames('clew-cal-column-event', info.isStart && 'clew-cal-column-event-start', info.isEnd && 'clew-cal-column-event-end'),
    columnEventBeforeClass: (info: { isStartResizable: boolean }) => joinClassNames(info.isStartResizable && 'clew-cal-resizer clew-cal-resizer-top'),
    columnEventAfterClass: (info: { isEndResizable: boolean }) => joinClassNames(info.isEndResizable && 'clew-cal-resizer clew-cal-resizer-bottom'),
    columnEventInnerClass: (info: { isShort: boolean; isNarrow: boolean }) => joinClassNames('clew-cal-column-event-inner', info.isShort && 'clew-cal-short', info.isNarrow && 'clew-cal-narrow'),
    columnEventTimeClass: 'clew-cal-column-event-time',
    columnEventTitleClass: 'clew-cal-column-event-title',
    moreLinkClass: focusable,
    moreLinkInnerClass: 'clew-cal-more-link-inner',
    columnMoreLinkClass: `clew-cal-column-more-link ${pressable} ${focusable}`,
    columnMoreLinkInnerClass: 'clew-cal-column-more-link-inner',

    /* Day headers and cells */
    dayHeaderAlign: 'center',
    dayHeaderClass: (info: { isToday: boolean; isMajor: boolean; isDisabled: boolean; inPopover: boolean }) =>
      joinClassNames('clew-cal-day-header', info.isToday && 'clew-cal-today', info.isMajor && 'clew-cal-major', info.isDisabled && !info.inPopover && 'clew-cal-disabled'),
    dayHeaderInnerClass: (info: { hasNavLink: boolean }) => joinClassNames('clew-cal-day-header-inner', info.hasNavLink && pressable),
    dayHeaderRowClass: 'clew-cal-day-header-row',
    dayHeaderDividerClass: 'clew-cal-divider',
    dayCellClass: (info: { isToday: boolean; isMajor: boolean; isDisabled: boolean; isOther: boolean }) =>
      joinClassNames('clew-cal-day-cell', info.isToday && 'clew-cal-today', info.isMajor && 'clew-cal-major', info.isDisabled && 'clew-cal-disabled', info.isOther && 'clew-cal-other'),
    dayCellTopClass: 'clew-cal-day-cell-top',
    dayCellTopInnerClass: (info: { isToday: boolean; hasNavLink: boolean; isOther: boolean; isNarrow: boolean }) =>
      joinClassNames('clew-cal-day-number', info.isToday && 'clew-cal-today', info.hasNavLink && `${pressable} ${focusable}`, info.isOther && 'clew-cal-other', info.isNarrow && 'clew-cal-narrow'),
    dayCellInnerClass: (info: { inPopover: boolean }) => joinClassNames(info.inPopover && 'clew-cal-day-cell-popover'),
    dayCellBottomClass: 'clew-cal-day-cell-bottom',
    dayRowClass: 'clew-cal-day-row',
    dayNarrowWidth: 100,

    /* Lanes and slots of the time grid */
    dayLaneClass: (info: { isToday: boolean; isMajor: boolean; isDisabled: boolean }) =>
      joinClassNames('clew-cal-day-lane', info.isToday && 'clew-cal-today', info.isMajor && 'clew-cal-major', info.isDisabled && 'clew-cal-disabled'),
    dayLaneInnerClass: (info: { isStack: boolean; isNarrow: boolean }) => joinClassNames('clew-cal-day-lane-inner', info.isStack && 'clew-cal-stack', info.isNarrow && 'clew-cal-narrow'),
    slotLaneClass: (info: { isMinor: boolean }) => joinClassNames('clew-cal-slot-lane', info.isMinor && 'clew-cal-minor'),

    /* Popover for "+2 till" */
    popoverFormat: { day: 'numeric', weekday: 'short' },
    popoverClass: 'clew-cal-popover',
    popoverCloseClass: `clew-cal-popover-close ${pressable} ${focusable}`,

    /* Misc */
    tableHeaderClass: 'clew-cal-table-header',
    fillerClass: 'clew-cal-filler',
    navLinkClass: focusable,
    inlineWeekNumberClass: 'clew-cal-inline-week-number',
    nonBusinessHoursClass: 'clew-cal-non-business',
    highlightClass: 'clew-cal-highlight',
    nowIndicatorLineClass: 'clew-cal-now-line',
    nowIndicatorDotClass: 'clew-cal-now-dot',
  },
  views: {
    dayGrid: { ...dayRowCommon },
    multiMonth: {
      ...dayRowCommon,
      singleMonthClass: 'clew-cal-single-month',
      singleMonthHeaderClass: 'clew-cal-single-month-header',
      singleMonthHeaderInnerClass: 'clew-cal-single-month-header-inner',
    },
    timeGrid: {
      ...dayRowCommon,
      weekNumberHeaderClass: 'clew-cal-week-number-header',
      weekNumberHeaderInnerClass: 'clew-cal-week-number-header-inner',
      allDayHeaderClass: 'clew-cal-all-day-header',
      allDayHeaderInnerClass: 'clew-cal-all-day-header-inner',
      allDayDividerClass: 'clew-cal-divider',
      slotHeaderClass: (info: { isMinor: boolean }) => joinClassNames('clew-cal-slot-header', info.isMinor && 'clew-cal-minor'),
      slotHeaderInnerClass: (info: { isFirst: boolean; isNarrow: boolean }) => joinClassNames('clew-cal-slot-header-inner', info.isFirst && 'clew-cal-first', info.isNarrow && 'clew-cal-narrow'),
      slotHeaderDividerClass: 'clew-cal-slot-header-divider',
    },
    list: {
      listDayClass: (info: { isLast: boolean }) => joinClassNames('clew-cal-list-day', !info.isLast && 'clew-cal-divider'),
      listDayHeaderClass: 'clew-cal-list-day-header',
      listDayHeaderInnerClass: (info: { isToday: boolean; hasNavLink: boolean; level: number }) =>
        joinClassNames('clew-cal-list-day-header-inner', info.level ? 'clew-cal-list-day-header-alt' : 'clew-cal-list-day-header-main', info.isToday && 'clew-cal-today', info.hasNavLink && `${pressable} ${focusable}`),
      listDayBodyClass: 'clew-cal-list-day-body',
      listItemEventClass: (info: { isInteractive: boolean; isSelected: boolean }) => joinClassNames('clew-cal-list-event', info.isInteractive && pressable, info.isSelected && 'clew-cal-selected'),
      listItemEventBeforeClass: 'clew-cal-list-event-dot',
      listItemEventInnerClass: 'clew-cal-list-event-inner',
      listItemEventTimeClass: 'clew-cal-list-event-time',
      listItemEventTitleClass: 'clew-cal-list-event-title',
      noEventsClass: 'clew-cal-no-events',
      noEventsInnerClass: 'clew-cal-no-events-inner',
    },
  },
};
