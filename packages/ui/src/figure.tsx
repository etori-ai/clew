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
// What the theme adds for the prototype's look (D115, `theme.ts`): a figure's label in small capitals (a text type), a value in its
// tone's colour, and the pill a suggestion under the box is drawn as.
declare module '@astryxdesign/core/theme' {
  interface CustomTextTypes {
    eyebrow: true;
  }
}
declare module '@astryxdesign/core/Text' {
  interface TextColorMap {
    success: true;
    warning: true;
    error: true;
  }
}
declare module '@astryxdesign/core/Divider' {
  interface DividerVariantMap {
    'status-error': true;
    'status-warning': true;
    'status-info': true;
    'status-success': true;
    'status-neutral': true;
  }
}
declare module '@astryxdesign/core/Button' {
  interface ButtonVariantMap {
    suggestion: true;
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
 * A figure's tile on Hem (D54, D115 item 4), drawn from `figureItems()` as the reference draws a key figure: the label
 * in small capitals with an arrow when the tile leads somewhere; the value large, in its tone's colour; a line with the
 * tone's word and the comparison, or the bar; and last the area the figure is from and the view it opens, the whole
 * tile then a link to it. Without a link it is a plain card and no arrow; without a value it is a sentence under the
 * area's name; a silent source is the warning. The tone is always said in words beside the colour (1.4.1).
 */
export function FigureTile({ tile, href }: { tile: Tile; href?: string }) {
  const linked = tile.kind === 'value' && !!tile.opens && !!href;
  // A figure that needs the person is the error colour, as its word says; else the tone's own.
  const color = tile.alert ? 'error' : tile.tone?.variant;
  const word = tile.alert ? 'Behöver dig' : tile.tone?.word;
  const head = (
    <HStack justify="between" vAlign="start" gap={2}>
      <Text type="eyebrow">{tile.kind === 'value' ? tile.label : tile.mark.title}</Text>
      {tile.kind === 'silent' ? (
        <Badge variant="warning" icon={<Icon icon="warning" size="sm" />} label="Svarar inte" />
      ) : (
        linked && <Icon icon="chevronRight" size="sm" color="secondary" />
      )}
    </HStack>
  );
  const body =
    tile.kind === 'value' ? (
      <VStack gap={1}>
        <Text type="display-3" hasTabularNumbers {...(color ? { color } : {})}>
          {tile.value}
        </Text>
        {tile.progress && (
          <ProgressBar
            label={tile.progress.label}
            isLabelHidden
            value={tile.progress.value}
            max={tile.progress.max}
            variant="neutral"
          />
        )}
        {(word || (!tile.progress && tile.comparison)) && (
          <Text type="supporting">{[word, tile.progress ? null : tile.comparison].filter(Boolean).join(' · ')}</Text>
        )}
      </VStack>
    ) : (
      <VStack gap={1}>
        <Text weight="medium" as="p">
          {tile.label}
        </Text>
        {word && <Text type="supporting">{word}</Text>}
      </VStack>
    );
  const foot =
    tile.kind === 'silent' ? (
      <Text type="supporting">{tile.comparison}</Text>
    ) : tile.kind === 'value' ? (
      <Text type="supporting">{[tile.mark.title, linked ? tile.opens!.title : null].filter(Boolean).join(' · ')}</Text>
    ) : null;
  const content = (
    <VStack gap={2} justify="between" height="100%" minHeight={104}>
      <VStack gap={2}>
        {head}
        {body}
      </VStack>
      {foot}
    </VStack>
  );
  // A figure that needs the person says so with its word and its colour; the tile itself is not outlined or tinted (D115 item 4).
  const variant = tile.kind === 'silent' ? 'muted' : 'default';
  return linked ? (
    <ClickableCard label={tile.name} href={href!} variant={variant} elevation="low" padding={5} height="100%">
      {content}
    </ClickableCard>
  ) : (
    <Card variant={variant} padding={5} height="100%">
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
