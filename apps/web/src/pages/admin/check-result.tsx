import type { ReactNode } from 'react';
import type { CheckGroup, CheckItem, CheckLevel, CheckReport } from '@clew/contracts';
import { useBranding } from '../../branding';
import { Banner, Code, Collapsible, CollapsibleGroup, HStack, List, ListItem, StatusDot, Text, VStack } from '@clew/ui';

/**
 * The conformance check as an administrator reads it (D44): the verdict in a Banner, then the rows grouped in Collapsibles
 * with a count on each. A group with something to look at opens by itself, its problems first; a group that passed stays
 * shut and says so. Colour never stands alone: every dot has its word.
 */
const GROUPS = (site: string): Array<{ id: CheckGroup; label: string }> => [
  { id: 'connection', label: 'Anslutning' },
  { id: 'capabilities', label: 'Funktioner' },
  { id: 'surfaces', label: `I ${site}` },
];
const SEVERITY: Record<CheckLevel, number> = { fail: 0, warn: 1, ok: 2 };
const DOT = {
  ok: { variant: 'success', label: 'Ok' },
  warn: { variant: 'warning', label: 'Varning' },
  fail: { variant: 'error', label: 'Fel' },
} as const;

/**
 * What a system, a model's endpoint or the network answered, in its own words (WA-L12): shown to an administrator, who
 * may need it to tell the system's owner, named as the technical cause and marked as English (3.1.2), since that is the
 * language a runtime's errors are in. Never shown to anyone outside the administration.
 */
export const TechnicalCause = ({ detail }: { detail: string }) => (
  <>
    Teknisk orsak, på engelska:{' '}
    <span lang="en">
      <Code size="inherit">{detail}</Code>
    </span>
  </>
);

/** One check's level as a dot with its word. */
export const LevelDot = ({ level }: { level: CheckLevel }) => <StatusDot {...DOT[level]} />;

const counted = (items: CheckItem[], level: CheckLevel) => items.filter(i => i.level === level).length;
const warnings = (n: number) => `${n} ${n === 1 ? 'varning' : 'varningar'}`;
/** "1 fel, 2 varningar, 5 godkända": only what there is. */
function tally(items: CheckItem[]) {
  const fail = counted(items, 'fail'),
    warn = counted(items, 'warn'),
    ok = counted(items, 'ok');
  return [fail && `${fail} fel`, warn && warnings(warn), ok && `${ok} ${ok === 1 ? 'godkänd' : 'godkända'}`]
    .filter(Boolean)
    .join(', ');
}

interface Failure {
  status?: 'warning' | 'error';
  title?: string;
  description: string;
}
function verdict(report: CheckReport, failure?: Failure) {
  const fail = counted(report.items, 'fail'),
    warn = counted(report.items, 'warn');
  if (!report.ok)
    return {
      status: failure?.status ?? 'error',
      title: failure?.title ?? `Kontrollen hittade ${fail} fel.`,
      description: failure?.description ?? 'Rätta tjänsten och testa igen.',
    } as const;
  if (warn)
    return {
      status: 'warning',
      title: `Anslutningen fungerar, med ${warnings(warn)}.`,
      description: 'Läs varningarna innan du slår på den.',
    } as const;
  return {
    status: 'success',
    title: 'Anslutningen fungerar.',
    description: `Alla ${report.items.length} kontroller gick bra.`,
  } as const;
}

export function CheckResult({
  report,
  failure,
  action,
}: {
  report: CheckReport;
  failure?: Failure;
  action?: ReactNode;
}) {
  const site = useBranding().name;
  const groups = GROUPS(site)
    .map(g => ({
      ...g,
      items: report.items.filter(i => i.group === g.id).sort((a, b) => SEVERITY[a.level] - SEVERITY[b.level]),
    }))
    .filter(g => g.items.length);
  const open = groups.filter(g => g.items.some(i => i.level !== 'ok')).map(g => g.id);
  return (
    <VStack gap={3}>
      <Banner {...verdict(report, failure)} container="section" collapsible={false} endContent={action} />
      {/* The key: a new check opens the groups that one needs, not the ones the last one did. */}
      <CollapsibleGroup key={open.join()} type="multiple" hasDividers density="compact" defaultValue={open}>
        {groups.map(g => (
          <Collapsible
            key={g.id}
            value={g.id}
            trigger={
              <HStack gap={2} vAlign="center">
                <LevelDot level={g.items[0]!.level} />
                <Text weight="semibold">{g.label}</Text>
                <Text type="supporting">{tally(g.items)}</Text>
              </HStack>
            }
          >
            <List density="compact" aria-label={g.label}>
              {g.items.map((item, i) => (
                <ListItem
                  key={i}
                  align="first-line"
                  startContent={<LevelDot level={item.level} />}
                  label={<Text>{item.label}</Text>}
                  description={
                    <VStack gap={0}>
                      {item.description && <Text type="supporting">{item.description}</Text>}
                      {item.cause && (
                        <Text type="supporting">
                          <TechnicalCause detail={item.cause} />
                        </Text>
                      )}
                      {item.capability && (
                        <Text type="supporting">
                          <Code size="inherit">{item.capability}</Code>
                        </Text>
                      )}
                    </VStack>
                  }
                />
              ))}
            </List>
          </Collapsible>
        ))}
      </CollapsibleGroup>
    </VStack>
  );
}
