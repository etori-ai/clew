import type { Figure } from '@clew/contracts';
import { Card, Grid, HStack, ProgressBar, StatusDot, Text, VStack } from '@clew/ui';

const dot = { ok: 'success', warn: 'warning', alert: 'error' } as const;
const toneLabel = { ok: 'Över mål', warn: 'Bevaka', alert: 'Åtgärd krävs' } as const;

/**
 * The four tiles at the top of the proof of concept (Min budget, Sjukfrånvaro …): Clew's figures as the server holds
 * them (`GET /api/figures`, D54 undecided), each a card with its label, its value, its tone and comparison, its
 * progress where it has one, and its source. The tiles are not links: nothing stands behind a figure yet.
 */
export function Figures({ figures }: { figures: Figure[] | undefined }) {
  if (!figures?.length) return null;
  return (
    <Grid columns={{ minWidth: 220, max: 4 }} gap={4}>
      {figures.map(f => (
        <Card key={f.id} padding={4}>
          <VStack gap={1} as="section" aria-label={f.label}>
            <Text type="supporting">{f.label}</Text>
            <Text size="2xl" weight="semibold">
              {f.value}
            </Text>
            <HStack gap={2} vAlign="center">
              <StatusDot variant={dot[f.tone]} label={toneLabel[f.tone]} />
              <Text type="supporting">{f.comparison}</Text>
            </HStack>
            {f.progress && (
              <ProgressBar
                label={`${f.label}: ${f.progress.value} av ${f.progress.max}`}
                value={f.progress.value}
                max={f.progress.max}
                variant={dot[f.tone]}
                isLabelHidden
              />
            )}
            <Text type="supporting">{f.source}</Text>
          </VStack>
        </Card>
      ))}
    </Grid>
  );
}
