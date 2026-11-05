import type { Figure } from '@clew/contracts';
import { ClickableCard, Grid, Heading, HStack, ProgressBar, StatusDot, Text, VStack } from '@clew/ui';

const dot = { ok: { variant: 'success', label: 'I balans' }, warn: { variant: 'warning', label: 'Bevaka' }, alert: { variant: 'error', label: 'Behöver åtgärd' } } as const;
type Props = { figures: Figure[]; unitLabel: string; compact?: boolean; onOpen: (figure: Figure) => void };

/** "Läget": always the same four figures, every tile a button that opens the thread behind it. Status is a dot with its word beside it, as StatusDot asks: never a colour alone (1.4.1). */
export function Lage({ figures, unitLabel, compact = false, onOpen }: Props) {
  return <VStack gap={2} as="section" aria-label="Läget i din verksamhet">
    <Heading level={2}>Läget · {unitLabel}</Heading>
    <Grid columns={compact ? { minWidth: 120, max: 2 } : { minWidth: 160, max: 4 }} gap={2}>
      {figures.map(f => <ClickableCard key={f.id} label={`${f.label}: ${f.value}, ${f.comparison}. ${dot[f.tone].label}`} onClick={() => onOpen(f)} padding={3}>
        <VStack gap={1}>
          <HStack gap={2} justify="between" vAlign="center">
            <Text type="supporting">{f.label}</Text>
          </HStack>
          <Text type="large" weight="semibold" hasTabularNumbers>{f.value}</Text>
          <HStack gap={1} vAlign="center"><StatusDot variant={dot[f.tone].variant} label={dot[f.tone].label} /><Text type="supporting" aria-hidden="true">{dot[f.tone].label}</Text></HStack>
          {!compact && <Text type="supporting">{f.comparison}</Text>}
          {!compact && f.progress && <ProgressBar label={`${f.label}: ${f.progress.value} av ${f.progress.max}`} isLabelHidden value={f.progress.value} max={f.progress.max} variant={f.tone === 'ok' ? 'success' : 'accent'} />}
        </VStack>
      </ClickableCard>)}
    </Grid>
  </VStack>;
}
