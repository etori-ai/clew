import { useLocation } from 'react-router';
import type { Area } from '@clew/contracts';
import { FigureTile, FigureTileSkeleton, Grid, Heading, Link, VStack, figureItems } from '@clew/ui';
import type { Source } from '../since';
import { useMarks } from '../marks';
import { unitPageHref } from '../person-address';

type Props = {
  areas: Area[];
  /** The areas are not read yet: the tiles' shape, never an empty Läget (D36). */
  loading: boolean;
  /** The sources' state from the last read of the cards: when a silent one last answered. */
  sources?: Source[] | undefined;
  now: string;
  unitLabel: string;
  /** The session's unit: its name in the heading links to the unit's page (D97, artboard M). Without it the name is text. */
  unitId?: string | undefined;
  /** Where a tile with `opens` leads: the view in the panel, in the address (D50). */
  viewHref: (capability: string, title: string) => string;
  /** At most two tiles across: a phone (artboard 11), one under the other when two would be too narrow (320 px). */
  twoAcross?: boolean;
};
const SKELETONS = 4;
/**
 * A tile's least width on a phone: two across from 340 px of column, so at 375 px with the board's gutter (351 px,
 * D115 item 4), and one column at 320 px, where two tiles of 142 px leave the value and its line too little room. A
 * tile's label wraps (it is a text type, not a chip), so nothing in it is cut at either width (1.4.10, 1.4.12).
 * Astryx's responsive `Grid` columns, never a fixed count, which "never reflows".
 */
const PHONE_TILE = 164;

/**
 * Läget (D54, artboard 3): one tile per area with a figure, in the order the areas come; an area whose connector
 * answered none, or that the person may not see, has no tile, and a connector that did not answer is the warning tile.
 * The figure is the connector's and the drawing Clew's (`figureItems`, `FigureTile`); nobody arranges the tiles.
 */
export function Lage({ areas, loading, sources, now, unitLabel, unitId, viewHref, twoAcross = false }: Props) {
  const { ofArea } = useMarks();
  const { pathname, search } = useLocation();
  const figured = areas.filter(a => a.figure);
  if (!loading && !figured.length) return null;
  return (
    <VStack gap={2} as="section" aria-label="Läget" aria-busy={loading}>
      <Heading level={3} accessibilityLevel={2}>
        Läget på{' '}
        {unitId ? (
          <Link href={unitPageHref(unitId, { from: pathname + search })} hasUnderline>
            {unitLabel}
          </Link>
        ) : (
          unitLabel
        )}
      </Heading>
      <Grid columns={twoAcross ? { minWidth: PHONE_TILE, max: 2 } : { minWidth: 180, max: 4 }} gap={3}>
        {loading
          ? Array.from({ length: SKELETONS }, (_, i) => <FigureTileSkeleton key={i} index={i} />)
          : figured.map(a => {
              const { tile } = figureItems(a.figure!, ofArea(a.id, a.connector), {
                now,
                lastRead: sources?.find(s => s.connector === a.connector)?.lastSuccess ?? null,
              });
              return (
                <FigureTile
                  key={a.connector + ':' + a.id}
                  tile={tile}
                  href={tile.opens ? viewHref(tile.opens.capability, tile.opens.title) : undefined}
                />
              );
            })}
      </Grid>
    </VStack>
  );
}
