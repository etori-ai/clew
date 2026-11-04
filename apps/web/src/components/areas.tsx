import type { Area } from '@clew/contracts';
import { List, ListItem, SideNav, SideNavItem, SideNavSection, StatusDot, Text } from '@clew/ui';

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
  const end = (a: Area) => a.needsYou ? <Text type="supporting">{a.needsYou}</Text>
    : a.waiting ? <Text type="supporting">{a.waiting} pågår</Text>
    : chippedArea(a, chipped) ? <StatusDot variant="accent" label="I samtalet" /> : undefined;
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
