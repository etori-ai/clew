import { fieldTone, type EntitySource, type View, type ViewField, type ViewTone } from '@clew/contracts';
import { Badge, Card, Grid, HStack, TONE_WORDS, Text, VStack } from '@clew/ui';
import { present } from '../view-fields';
import { FieldValue, fieldText } from './view';
import { rowOf, type SectionAnswer } from './entity-sections';

type Row = Record<string, unknown>;
type RowsView = Extract<View, { kind: 'table' | 'list' }>;
const rowsView = (view: View): RowsView | null => (view.kind === 'table' || view.kind === 'list' ? view : null);

/**
 * A source's row about a unit in short (D117): its title field, the value that names the row ("−2,1 mnkr", "6,3 %"),
 * and the first state the view gives a tone ("Mot underskott", "Bevaka"), with that tone. The overview of Dialogstöd and
 * the unit's key figures draw the same thing, so a unit reads alike in both places.
 */
export interface RowSummary {
  title?: ViewField;
  state?: ViewField;
  tone: ViewTone;
}
export function summaryOf(source: EntitySource, row: Row): RowSummary {
  const view = rowsView(source.view);
  if (!view) return { tone: 'none' };
  const title = view.fields.find(f => f.key === view.title);
  const state = view.fields.find(f => f.format === 'status' && f.key !== view.title && present(row[f.key]));
  return {
    ...(title && present(row[title.key]) ? { title } : {}),
    ...(state ? { state } : {}),
    tone: state ? fieldTone(state, row[state.key]) : 'none',
  };
}
/** The title field's label, the measure a column shows ("Avvikelse mot budget"), or the source's title without one. */
export const measureOf = (source: EntitySource) => {
  const view = rowsView(source.view);
  return view?.fields.find(f => f.key === view.title)?.label ?? source.title;
};
/** How much a tone weighs when the units are ordered: what needs action first, then what to watch. */
export const toneWeight = (tone: ViewTone) => (tone === 'alert' ? 2 : tone === 'warn' ? 1 : 0);

/**
 * A state in Clew's words (D54): the badge says Lugnt, Bevaka or Behöver dig, as every figure on Hem does, whichever
 * system sent it, and the source's own word ("Mot underskott", "Åtgärd krävs: Verksamhet") follows as supporting text
 * where it says more. A state the view gives no tone is the source's word alone, plain.
 */
export function StateWords({ field, value, tone }: { field: ViewField; value: unknown; tone: ViewTone }) {
  const words = fieldText(field, value);
  if (tone === 'none') return <Text type="supporting">{words}</Text>;
  const clew = TONE_WORDS[tone];
  // "Bevaka: Verksamhet" beside the badge "Bevaka" says only what the badge does not: "Verksamhet".
  const rest = words.startsWith(clew.word + ': ') ? words.slice(clew.word.length + 2) : words;
  return (
    <HStack gap={2} vAlign="center" wrap="wrap">
      <Badge variant={clew.variant} label={clew.word} />
      {rest !== clew.word && <Text type="supporting">{rest}</Text>}
    </HStack>
  );
}

/** The row in short on one line: the value, then its state in Clew's words. */
export function Summary({ source, row }: { source: EntitySource; row: Row }) {
  const { title, state, tone } = summaryOf(source, row);
  return (
    <HStack gap={2} vAlign="center" wrap="wrap">
      {title && <FieldValue field={title} value={row[title.key]} text="ordinary" />}
      {state && <StateWords field={state} value={row[state.key]} tone={tone} />}
    </HStack>
  );
}

/**
 * The unit's key figures as a row of cards above its sections (D117): each source that answered with a row, its title,
 * its value large and its state, so what the follow-up is about stands first and the details follow in the sections.
 * Nothing while no source has a row.
 */
export function KeyFigureTiles({ answers }: { answers: SectionAnswer[] }) {
  const shown = answers.flatMap(a => {
    const row = rowOf(a);
    if (!row) return [];
    const summary = summaryOf(a.source, row);
    return summary.title ? [{ source: a.source, row, summary, title: summary.title }] : [];
  });
  if (!shown.length) return null;
  return (
    <Grid columns={{ minWidth: 200, max: 4 }} gap={3}>
      {shown.map(({ source, row, summary, title }) => (
        <Card key={source.capability} padding={4}>
          <VStack gap={2}>
            <Text type="supporting">{source.title}</Text>
            <Text type="display-3" hasTabularNumbers>
              {fieldText(title, row[title.key])}
            </Text>
            {summary.state && <StateWords field={summary.state} value={row[summary.state.key]} tone={summary.tone} />}
          </VStack>
        </Card>
      ))}
    </Grid>
  );
}
