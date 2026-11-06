import type { Figure } from '@clew/contracts';
import { ClickableCard, Grid, Heading, HStack, ProgressBar, StatusDot, Text, VStack } from '@clew/ui';

const dot = {
  ok: { variant: 'success', label: 'I balans' },
  warn: { variant: 'warning', label: 'Bevaka' },
  alert: { variant: 'error', label: 'Behöver åtgärd' },
} as const;
type Props = {
  figures: Figure[];
  unitLabel: string;
  /** Two tiles a row: a phone, or the column beside an open panel (artboard E). */
  compact?: boolean;
  onOpen: (figure: Figure) => void;
};

/**
 * "Läget" (artboard A): always the same four figures, every tile a button that asks about the figure. The tile is the
 * label with its status dot at the end of the line, the value, and one line with the status word and the comparison,
 * or a bar where the figure is a count towards a target. The dot carries its word for a reader; the line carries it
 * for the eye, so a colour is never alone (1.4.1).
 */
export function Lage({ figures, unitLabel, compact = false, onOpen }: Props) {
  return (
    <VStack gap={2} as="section" aria-label="Läget i din verksamhet">
      <HStack justify="between" vAlign="center" gap={3} wrap="wrap">
        <Heading level={3} accessibilityLevel={2}>
          Läget · {unitLabel}
        </Heading>
        {!compact && <Text type="supporting">Alltid samma fyra · varje ruta öppnar sin tråd</Text>}
      </HStack>
      <Grid columns={compact ? { minWidth: 140, max: 2 } : { minWidth: 160, max: 4 }} gap={3}>
        {figures.map(f => (
          <ClickableCard
            key={f.id}
            label={`${f.label}: ${f.value}, ${f.comparison}. ${dot[f.tone].label}`}
            onClick={() => onOpen(f)}
            padding={4}
          >
            <VStack gap={1.5}>
              <HStack gap={2} justify="between" vAlign="center">
                <Text type="supporting">{f.label}</Text>
                <StatusDot variant={dot[f.tone].variant} label={dot[f.tone].label} />
              </HStack>
              <Text size="2xl" weight="semibold" hasTabularNumbers>
                {f.value}
              </Text>
              {f.progress ? (
                <ProgressBar
                  label={`${f.label}: ${f.progress.value} av ${f.progress.max}`}
                  isLabelHidden
                  value={f.progress.value}
                  max={f.progress.max}
                  variant="accent"
                />
              ) : (
                <Text type="supporting" aria-hidden="true">
                  {dot[f.tone].label} · {f.comparison}
                </Text>
              )}
            </VStack>
          </ClickableCard>
        ))}
      </Grid>
    </VStack>
  );
}
