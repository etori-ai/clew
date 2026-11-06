import { Badge } from '@astryxdesign/core/Badge';
import { Card } from '@astryxdesign/core/Card';
import { ClickableCard } from '@astryxdesign/core/ClickableCard';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { ProgressBar } from '@astryxdesign/core/ProgressBar';
import { Skeleton } from '@astryxdesign/core/Skeleton';
import { StatusDot } from '@astryxdesign/core/StatusDot';
import { Text } from '@astryxdesign/core/Text';
import { AreaChip, AreaGlyph } from './mark';
import type { FigureLine as Line, FigureTile as Tile, ToneWord } from './figure-items';

// The variant the theme adds to Astryx's Card (theme.ts, the documented `variant:value` extension): the card background
// with an error-coloured outline, for a figure whose tone needs the person (D54, artboard 3).
declare module '@astryxdesign/core/Card' {
  interface CardVariantMap {
    alert: true;
  }
}

/** The tone with its word (1.4.1): the dot is named by the word beside it, so a reader hears it once. */
function Tone({ tone }: { tone: ToneWord }) {
  return (
    <HStack gap={1.5} vAlign="center">
      <StatusDot variant={tone.variant} label={tone.word} />
      <Text type="supporting" weight="medium" aria-hidden="true">
        {tone.word}
      </Text>
    </HStack>
  );
}

/**
 * A figure's tile on Hem (D54, artboard 3), drawn from `figureItems()`. The chip top left and the tone top right on a
 * line that wraps, so the tone goes under the chip when both do not fit; the label in supporting over the value in
 * display-3; the comparison or the bar; last the view it opens with a chevron, the whole tile then a link to it. Without
 * a link it is a plain card, no chevron and no shadow; without a value it is a sentence; a silent source is the warning.
 */
export function FigureTile({ tile, href }: { tile: Tile; href?: string }) {
  const head = (
    <HStack justify="between" vAlign="center" gap={2} wrap="wrap">
      <AreaChip ordinal={tile.mark.ordinal} icon={tile.mark.icon} label={tile.mark.title} />
      {tile.kind === 'silent' ? (
        <Badge variant="warning" icon={<Icon icon="warning" size="sm" />} label="Svarar inte" />
      ) : tile.alert ? (
        <Badge variant="error" label="Behöver dig" />
      ) : (
        tile.tone && <Tone tone={tile.tone} />
      )}
    </HStack>
  );
  const body =
    tile.kind === 'value' ? (
      <VStack gap={2}>
        <VStack gap={0}>
          <Text type="supporting">{tile.label}</Text>
          <Text type="display-3" hasTabularNumbers>
            {tile.value}
          </Text>
        </VStack>
        {tile.progress ? (
          <ProgressBar
            label={tile.progress.label}
            isLabelHidden
            value={tile.progress.value}
            max={tile.progress.max}
            variant="neutral"
          />
        ) : (
          tile.comparison && <Text type="supporting">{tile.comparison}</Text>
        )}
      </VStack>
    ) : (
      <Text weight="medium" as="p">
        {tile.label}
      </Text>
    );
  const foot =
    tile.kind === 'silent' ? (
      <Text type="supporting">{tile.comparison}</Text>
    ) : tile.opens && href ? (
      <HStack gap={1} vAlign="center">
        <Text type="supporting" weight="medium">
          {tile.opens.title}
        </Text>
        <Icon icon="chevronRight" size="sm" />
      </HStack>
    ) : null;
  const content = (
    <VStack gap={3} justify="between" height="100%" minHeight={118}>
      <VStack gap={2}>
        {head}
        {body}
      </VStack>
      {foot}
    </VStack>
  );
  const variant = tile.alert ? 'alert' : tile.kind === 'silent' ? 'muted' : 'default';
  return tile.kind === 'value' && tile.opens && href ? (
    <ClickableCard label={tile.name} href={href} variant={variant} elevation="low" padding={4} height="100%">
      {content}
    </ClickableCard>
  ) : (
    <Card variant={variant} padding={4} height="100%">
      <VStack role="group" aria-label={tile.name} height="100%">
        {content}
      </VStack>
    </Card>
  );
}

/** The tile's shape while the areas are read (D36): the chip and the tone, the label and the value, the last line. */
export function FigureTileSkeleton({ index = 0 }: { index?: number }) {
  return (
    <Card padding={4} height="100%">
      <VStack gap={3} justify="between" minHeight={118} aria-hidden="true">
        <VStack gap={3}>
          <HStack justify="between" vAlign="center" gap={2}>
            <Skeleton width={96} height={24} radius="rounded" index={index} />
            <Skeleton width={48} height={12} index={index} />
          </HStack>
          <VStack gap={2}>
            <Skeleton width={80} height={12} index={index} />
            <Skeleton width={120} height={28} index={index} />
          </VStack>
        </VStack>
        <Skeleton width={150} height={12} index={index} />
      </VStack>
    </Card>
  );
}

/**
 * A figure as a line in a text (D54, artboard 3: Sedan i går, an answer that read a figure): the area's glyph, the
 * label in supporting, the value semibold and tabular at body size, the dot with its word, then the comparison and the
 * source with its time in supporting. Never display size outside the tile. The pieces wrap as words do.
 */
export function FigureLine({ line }: { line: Line }) {
  return (
    <HStack gap={2} vAlign="center" wrap="wrap">
      <AreaGlyph icon={line.icon} />
      <Text type="supporting">{line.label}</Text>
      {line.value && (
        <Text weight="semibold" hasTabularNumbers>
          {line.value}
        </Text>
      )}
      {line.tone && <Tone tone={line.tone} />}
      {line.rest && <Text type="supporting">{line.rest}</Text>}
    </HStack>
  );
}
