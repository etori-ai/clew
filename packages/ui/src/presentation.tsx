import type { Activity, Metric, Series } from '@clew/contracts';
import { Badge } from '@astryxdesign/core/Badge';
import { Card } from '@astryxdesign/core/Card';
import { Grid } from '@astryxdesign/core/Grid';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { List, ListItem } from '@astryxdesign/core/List';
import { Text } from '@astryxdesign/core/Text';
import { Table, proportional } from '@astryxdesign/core/Table';

const instant = (value: string) =>
  new Intl.DateTimeFormat('sv-SE', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
const value = (n: number | null, unit: string) =>
  n === null ? 'Uppgift saknas' : `${n.toLocaleString('sv-SE')} ${unit}`.trim();
const status = {
  ok: ['success', 'Enligt plan'],
  warn: ['warning', 'Observera'],
  alert: ['error', 'Behöver åtgärd'],
  none: ['neutral', ''],
} as const;
export function MetricView({ metrics }: { metrics: Metric[] }) {
  return metrics.length ? (
    <Grid columns={{ minWidth: 180, max: 3 }} gap={3}>
      {metrics.map(metric => (
        <Card key={metric.id} padding={3}>
          <VStack gap={1}>
            <HStack gap={2} wrap="wrap" justify="between">
              <Text weight="semibold">{metric.label}</Text>
              {metric.tone !== 'none' && <Badge variant={status[metric.tone][0]} label={status[metric.tone][1]} />}
            </HStack>
            <Text size="lg" weight="semibold" hasTabularNumbers>
              {value(metric.value, metric.unit)}
            </Text>
            {metric.target !== undefined && <Text type="supporting">Mål: {value(metric.target, metric.unit)}</Text>}
            {metric.comparison && <Text type="supporting">{metric.comparison}</Text>}
            <Text type="supporting">
              {metric.period} · uppgifter från {instant(metric.dataAt)}
            </Text>
          </VStack>
        </Card>
      ))}
    </Grid>
  ) : (
    <Text>Inga mätvärden att visa.</Text>
  );
}
const role = { actual: 'Utfall', forecast: 'Prognos', target: 'Mål' };
/** Bounded, semantic SVG is D79's chart exception. The table is the complete, keyboard-accessible equivalent. */
export function SeriesView({ series: data, chart = 'line' }: { series: Series; chart?: 'line' | 'bar' }) {
  const numbers = data.series.flatMap(s => s.values.filter((n): n is number => n !== null));
  const min = Math.min(0, ...numbers),
    max = Math.max(0, ...numbers),
    span = max - min || 1;
  const time = data.categories.map(c => Date.parse(c));
  const x = (i: number) =>
    66 +
    (chart === 'bar'
      ? (i + 0.5) / data.categories.length
      : data.axis === 'time'
        ? (time[i]! - time[0]!) / (time.at(-1)! - time[0]! || 1)
        : i / Math.max(1, data.categories.length - 1)) *
      480;
  const y = (n: number) => 190 - ((n - min) / span) * 160;
  const stroke = (i: number) => ['0', '8 4', '2 4', '12 3 2 3', '4 2', '10 6'][i];
  type Row = { id: string; category: string; index: number };
  return (
    <VStack gap={2}>
      <Text weight="semibold">{data.title}</Text>
      <Text type="supporting">
        {data.period} · {data.unit} · uppgifter från {instant(data.dataAt)}
      </Text>
      <svg viewBox="0 0 600 240" width="100%" height="240" aria-hidden="true" focusable="false">
        <line x1="66" x2="546" y1={y(0)} y2={y(0)} stroke="currentColor" />
        <text x="60" y="30" textAnchor="end" fill="currentColor" fontSize="12">
          {max.toLocaleString('sv-SE', { notation: 'compact' })}
        </text>
        <text x="60" y="190" textAnchor="end" fill="currentColor" fontSize="12">
          {min.toLocaleString('sv-SE', { notation: 'compact' })}
        </text>
        {data.series.map((s, si) => (
          <g key={s.id} stroke="currentColor" fill="none" strokeWidth="2" strokeDasharray={stroke(si)}>
            {chart === 'bar' ? (
              s.values.map((n, i) =>
                n === null ? null : (
                  <rect
                    key={i}
                    x={x(i) - 200 / data.categories.length + (si * 400) / data.categories.length / data.series.length}
                    y={Math.min(y(n), y(0))}
                    width={Math.max(1, 380 / data.categories.length / data.series.length)}
                    height={Math.abs(y(n) - y(0))}
                  />
                ),
              )
            ) : (
              <>
                <path
                  d={s.values
                    .map((n, i) =>
                      n === null ? '' : `${i === 0 || s.values[i - 1] === null ? 'M' : 'L'}${x(i)},${y(n)}`,
                    )
                    .join(' ')}
                />
                {s.values.map((n, i) => (n === null ? null : <circle key={i} cx={x(i)} cy={y(n)} r="3" />))}
              </>
            )}
          </g>
        ))}
        <text x="66" y="220" fill="currentColor" fontSize="12">
          {data.categories[0]}
        </text>
        <text x="546" y="220" textAnchor="end" fill="currentColor" fontSize="12">
          {data.categories.length > 1 ? data.categories.at(-1) : ''}
        </text>
      </svg>
      <HStack wrap="wrap" gap={3}>
        {data.series.map((s, i) => (
          <HStack key={s.id} gap={1} vAlign="center">
            <svg width="24" height="12" aria-hidden="true">
              <line x1="0" x2="24" y1="6" y2="6" stroke="currentColor" strokeWidth="2" strokeDasharray={stroke(i)} />
            </svg>
            <Text type="supporting">
              {s.label} ({role[s.role]})
            </Text>
          </HStack>
        ))}
      </HStack>
      <Table<Row>
        aria-label={`${data.title}, värden`}
        density="compact"
        data={data.categories.map((category, index) => ({ id: String(index), category, index }))}
        idKey="id"
        columns={[
          {
            key: 'category',
            header: data.axis === 'time' ? 'Tidpunkt' : 'Kategori',
            width: proportional(1, { minWidth: 130 }),
          },
          ...data.series.map(s => ({
            key: s.id,
            header: `${s.label} (${role[s.role]})`,
            width: proportional(1, { minWidth: 160 }),
            align: 'end' as const,
            renderCell: (row: Row) => <Text hasTabularNumbers>{value(s.values[row.index] ?? null, data.unit)}</Text>,
          })),
        ]}
      />
    </VStack>
  );
}
export function ActivityView({ activity }: { activity: Activity }) {
  return activity.length ? (
    <List aria-label="Händelser" hasDividers density="compact">
      {[...activity]
        .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
        .map(event => (
          <ListItem
            key={event.id}
            label={event.title}
            description={
              <VStack gap={1}>
                <Text type="supporting">
                  {instant(event.at)}
                  {event.actor ? ` · ${event.actor}` : ''}
                </Text>
                {event.detail && <Text>{event.detail}</Text>}
              </VStack>
            }
          />
        ))}
    </List>
  ) : (
    <Text>Inga händelser att visa.</Text>
  );
}
