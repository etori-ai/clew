import type { Area } from '@clew/contracts';
import { FigureTile, FigureTileSkeleton, Grid, Heading, VStack, figureItems } from '@clew/ui';
import type { Source } from '../since';
import { useMarks } from '../marks';

type Props = {
  areas: Area[];
  /** The areas are not read yet: the tiles' shape, never an empty Läget (D36). */
  loading: boolean;
  /** The sources' state from the last read of the cards: when a silent one last answered. */
  sources?: Source[] | undefined;
  now: string;
  unitLabel: string;
  /** Where a tile with `opens` leads: the view in the panel, in the address (D50). */
  viewHref: (capability: string, title: string) => string;
  /** Two tiles across: a phone (artboard 11). */
  twoAcross?: boolean;
};
const SKELETONS = 4;

/**
 * Läget (D54, artboard 3): one tile per area with a figure, in the order the areas come; an area whose connector
 * answered none, or that the person may not see, has no tile, and a connector that did not answer is the warning tile.
 * The figure is the connector's and the drawing Clew's (`figureItems`, `FigureTile`); nobody arranges the tiles.
 */
export function Lage({ areas, loading, sources, now, unitLabel, viewHref, twoAcross = false }: Props) {
  const { ofArea } = useMarks();
  const figured = areas.filter(a => a.figure);
  if (!loading && !figured.length) return null;
  return (
    <VStack gap={2} as="section" aria-label="Läget" aria-busy={loading}>
      <Heading level={3} accessibilityLevel={2}>
        Läget · {unitLabel}
      </Heading>
      <Grid columns={twoAcross ? 2 : { minWidth: 180, max: 4 }} gap={3}>
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
