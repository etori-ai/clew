import type { Area } from '@clew/contracts';
import { HStack, List, ListItem, SideNav, SideNavItem, SideNavSection, StatusDot, Text } from '@clew/ui';

type Props = {
  areas: Area[];
  /** The area in view: `null` is Allt, `undefined` means no area is selected (a pile or a conversation is open). */
  current: string | null | undefined;
  hrefFor: (id: string | null) => string;
  chipped?: string[];
};
/** A capability chip in the row (`capability:<connector>.<name>`) points at the area that owns it: the lens on that connector. */
const chippedArea = (a: Area, chipped: string[]) => chipped.some(ref => ref.startsWith('capability:') && (ref.startsWith(`capability:${a.connector}.`) || a.standing.some(s => 'capability:' + s.capability === ref)));

/**
 * The areas as the shell's SideNav (D31): Allt and one destination per area, the count as passive end content, then
 * Kommande, the assistant's own schedule. Lenses on one stream, not pages; the figure line is on the area's page lead.
 * Below the shell's breakpoint AppShell moves this into its drawer.
 */
export function AreasNav({ areas, current, hrefFor, chipped = [] }: Props) {
  const total = areas.reduce((n, a) => n + a.needsYou, 0);
  const upcoming = areas.flatMap(a => a.schedules.map(s => ({ ...s, area: a.title }))).slice(0, 5);
  // The count is text; what needs the eye is a dot with its word: the area's figure out of balance, or a deadline today in the area (Astryx: StatusDot for status, never a coloured count).
  const tone = { ok: null, warn: 'warning', alert: 'error', none: null } as const;
  const dot = (a: Area) => {
    const figure = a.figure ? tone[a.figure.tone] : null;
    const urgency = a.urgency === 'now' || a.urgency === 'urgent' ? 'error' : a.urgency === 'soon' ? 'warning' : null;
    const variant = figure === 'error' || urgency === 'error' ? 'error' : figure ?? urgency;
    const label = figure && a.figure ? a.figure.label : urgency === 'error' ? 'Deadline i dag' : 'Snart';
    return variant ? <StatusDot variant={variant} label={label} tooltip={label} /> : chippedArea(a, chipped) ? <StatusDot variant="accent" label="I samtalet" tooltip="I samtalet" /> : null;
  };
  const end = (a: Area) => {
    const count = a.needsYou ? <Text type="supporting">{a.needsYou}</Text> : a.waiting ? <Text type="supporting">{a.waiting} pågår</Text> : null;
    const mark = dot(a);
    return count || mark ? <HStack gap={1} vAlign="center">{mark}{count}</HStack> : undefined;
  };
  return <SideNav>
    <SideNavSection title="Områden">
      <SideNavItem label="Allt" href={hrefFor(null)} isSelected={current === null} endContent={total ? <Text type="supporting">{total}</Text> : undefined} />
      {areas.map(a => <SideNavItem key={a.id} label={a.title} href={hrefFor(a.id)} isSelected={current === a.id} endContent={end(a)} />)}
    </SideNavSection>
    {upcoming.length > 0 && <SideNavSection title="Kommande">
      <List density="compact" aria-label="Kommande">
        {upcoming.map((s, i) => <ListItem key={i} label={<Text>{s.when}</Text>} description={<Text type="supporting">{s.label} · {s.area}</Text>} />)}
      </List>
    </SideNavSection>}
  </SideNav>;
}
