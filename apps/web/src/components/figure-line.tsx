import { useQuery } from '@tanstack/react-query';
import type { Area } from '@clew/contracts';
import { FigureLine, VStack, figureItems } from '@clew/ui';
import { areasQuery } from '../queries';
import { useMarks } from '../marks';

const EMPTY_AREAS: Area[] = [];

/**
 * Figures as lines in a text (D54, artboard 3): under an answer that read an area with a figure, and in Sedan i går.
 * `select` picks the areas: by id for an answer (the areas its view's meta names), by tone for Sedan i går. The figure
 * is read from the person's areas, so a line says what the tile on Hem says; an area without a figure draws nothing.
 */
export function FigureLines({ select, now }: { select: (area: Area) => boolean; now: string }) {
  const areas = useQuery(areasQuery).data?.areas ?? EMPTY_AREAS;
  const { ofArea } = useMarks();
  const lines = areas
    .filter(a => a.figure && select(a))
    .map(a => ({
      key: a.connector + ':' + a.id,
      line: figureItems(a.figure!, ofArea(a.id, a.connector), { now }).line,
    }));
  if (!lines.length) return null;
  return (
    <VStack gap={1.5}>
      {lines.map(l => (
        <FigureLine key={l.key} line={l.line} />
      ))}
    </VStack>
  );
}
