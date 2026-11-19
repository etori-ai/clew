import { useLocation } from 'react-router';
import type { Area } from '@clew/contracts';
import {
  Card,
  FigureRow,
  FigureTileSkeleton,
  Heading,
  HStack,
  KeyFigure,
  Link,
  Text,
  TONE_WORDS,
  VStack,
} from '@clew/ui';
import { DOT } from '../../dot';
import { unitPageHref } from '../../person-address';
import { LAGE_ON_HEM, lageOnHem } from '../../lage-figures';

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
 * One figure as Hem's tile (D130 item 9): the shared key figure, with its status (Lugnt, Bevaka or Behöver dig, D54) as
 * its colour and its word, what it is compared with, and the area it is from. It leads to the figure's page: the view it
 * opens, else the unit's page, where every figure is. Named by the label, the value and the status.
 */
function Tile({ area, href }: { area: Area; href: string | null }) {
  const figure = area.figure!;
  const tone = figure.tone === 'none' ? null : TONE_WORDS[figure.tone];
  return (
    <KeyFigure
      label={figure.label}
      value={figure.value ?? ''}
      tone={tone?.variant}
      line={[tone?.word, figure.comparison].filter(Boolean).join(DOT)}
      foot={area.title}
      href={href}
      name={[`${figure.label} ${figure.value ?? ''}`.trim(), tone?.word].filter(Boolean).join(', ')}
    />
  );
}

/**
 * "Läget på <enhet>" on Hem (D54; D126, board Hem): a manager's unit at a glance in one row, at most four figures, the
 * worst status first (`lageOnHem`); a figure with nothing to show (an empty state, a source that does not answer) is
 * not drawn here. The unit's page holds every figure: the link at the end of the heading's line reads "Visa alla (N)"
 * when there are more than the row shows (the product owner, 2026-11-14: a person must see that the row is a
 * selection), else "Enhetens sida" as the board draws it. The figure is the connector's and the drawing Clew's.
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
        <FigureRow>
          {loading
            ? Array.from({ length: LAGE_ON_HEM }, (_, i) => <FigureTileSkeleton key={i} index={i} />)
            : shown.map(a => (
                <Tile
                  key={a.connector + ':' + a.id}
                  area={a}
                  href={a.figure!.opens ? tileHref(a.figure!.opens.capability, a.figure!.opens.title) : unitHref}
                />
              ))}
        </FigureRow>
      )}
    </VStack>
  );
}
