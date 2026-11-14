import { useLocation } from 'react-router';
import type { Area } from '@clew/contracts';
import {
  Badge,
  Card,
  ClickableCard,
  FigureTileSkeleton,
  Grid,
  Heading,
  HStack,
  Link,
  TONE_WORDS,
  Text,
  VStack,
} from '@clew/ui';
import { unitPageHref } from '../person-address';
import { LAGE_ON_HEM, lageOnHem } from '../lage-figures';

type Props = {
  areas: Area[];
  /** The areas are not read yet: the tiles' shape, never an empty Läget (D36). */
  loading: boolean;
  unitLabel: string;
  /** The session's unit: the way to its page (D97, artboard M), where every figure is. Without it there is no such link. */
  unitId?: string | undefined;
  /** The page a figure's view is (D126 rule 1): its own page, or the tool's when it is one. */
  tileHref: (capability: string, title: string) => string;
};

/**
 * One figure as Hem's tile (D126, board Hem), every tile the same shape: what the figure is, in supporting text, with
 * its status as one badge at the end of that line (Lugnt, Bevaka or Behöver dig, D54; none for a figure without a
 * tone), the value large, and one note under it, what it is compared with. The whole tile is a `ClickableCard` to the
 * figure's page: the view it opens, else the unit's page, where every figure is. Named by the label, the value and the
 * status. The badge carries the status: no outline, no area mark, no bar.
 */
function Tile({ area, href }: { area: Area; href: string | null }) {
  const figure = area.figure!;
  const tone = figure.tone === 'none' ? null : TONE_WORDS[figure.tone];
  const name = [`${figure.label} ${figure.value ?? ''}`.trim(), tone?.word].filter(Boolean).join(', ');
  const content = (
    <VStack gap={2}>
      <HStack justify="between" vAlign="center" gap={2}>
        <Text type="supporting" color="secondary">
          {figure.label}
        </Text>
        {tone && <Badge variant={tone.variant} label={tone.word} />}
      </HStack>
      <Text type="display-3" hasTabularNumbers>
        {figure.value}
      </Text>
      {figure.comparison && (
        <Text type="supporting" color="secondary">
          {figure.comparison}
        </Text>
      )}
    </VStack>
  );
  return href ? (
    <ClickableCard label={name} href={href} padding={4} height="100%">
      {content}
    </ClickableCard>
  ) : (
    <Card padding={4} height="100%">
      <VStack role="group" aria-label={name}>
        {content}
      </VStack>
    </Card>
  );
}

/**
 * "Läget på <enhet>" on Hem (D54; D126, board Hem): a manager's unit at a glance in one row, at most four figures, the
 * worst status first (`lageOnHem`); a figure with nothing to show (an empty state, a source that does not answer) is
 * not drawn here. The unit's page holds every figure: the link at the end of the heading's line reads "Visa alla (N)"
 * when there are more than the row shows, else "Enhetens sida". The figure is the connector's and the drawing Clew's.
 */
export function Lage({ areas, loading, unitLabel, unitId, tileHref }: Props) {
  const { pathname, search } = useLocation();
  const { shown, total } = lageOnHem(areas);
  if (!loading && !total) return null;
  const unitHref = unitId ? unitPageHref(unitId, { from: pathname + search }) : null;
  return (
    <VStack gap={3} as="section" aria-labelledby="laget" aria-busy={loading}>
      <HStack justify="between" vAlign="center" gap={2} wrap="wrap">
        <Heading id="laget" level={2}>
          Läget på {unitLabel}
        </Heading>
        {unitHref && !loading && (
          <Link href={unitHref}>{total > shown.length ? `Visa alla (${total})` : 'Enhetens sida'}</Link>
        )}
      </HStack>
      {!loading && !shown.length ? (
        <Card padding={4}>
          <Text as="p" color="secondary">
            Inga siffror att visa just nu.
          </Text>
        </Card>
      ) : (
        <Grid columns={{ minWidth: 200, max: LAGE_ON_HEM }} gap={4}>
          {loading
            ? Array.from({ length: LAGE_ON_HEM }, (_, i) => <FigureTileSkeleton key={i} index={i} />)
            : shown.map(a => (
                <Tile
                  key={a.connector + ':' + a.id}
                  area={a}
                  href={a.figure!.opens ? tileHref(a.figure!.opens.capability, a.figure!.opens.title) : unitHref}
                />
              ))}
        </Grid>
      )}
    </VStack>
  );
}
