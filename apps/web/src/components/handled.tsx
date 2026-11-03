import type { Thread } from '@clew/contracts';
import { Badge, Button, Card, Collapsible, Icon, List, ListItem, Text, VStack } from '@clew/ui';
import { api } from '../api';

/** "Redan hanterat" and older threads: one line each with what happened, and undo while the window is open. */
export function Handled({ threads, onChange }: { threads: Thread[]; onChange: (thread: Thread) => void }) {
  if (!threads.length) return null;
  const summary = threads.slice(0, 2).map(t => t.title.toLowerCase()).join(' · ');
  return <Card padding={0}>
    <Collapsible defaultIsOpen={false} trigger={<VStack gap={0} padding={3}><Text weight="medium">Dina trådar och redan hanterat · {threads.length}</Text><Text type="supporting">{summary}</Text></VStack>}>
      <List hasDividers edge="padded">
        {threads.map(t => {
          const last = [...t.messages].reverse().find(m => m.role === 'assistant');
          const undoUntil = t.proposals.map(p => p.undoUntil).filter((v): v is string => !!v).sort().at(-1);
          const undoOpen = !!undoUntil && Date.parse(undoUntil) > Date.now() && t.proposals.some(p => p.status === 'confirmed');
          return <ListItem key={t.id} startContent={<Icon icon={t.state === 'dismissed' ? 'clock' : 'check'} color={t.state === 'dismissed' ? 'secondary' : 'success'} />}
            label={t.title} description={last?.body ?? t.trigger.reason} align="start"
            endContent={undoOpen ? <Button size="sm" label="Ångra" clickAction={async () => onChange(await api.undo(t.id))} /> : <Badge variant="neutral" label={t.state === 'dismissed' ? 'Inte nu' : t.kind === 'question' ? 'Fråga' : 'Klart'} />} />;
        })}
      </List>
    </Collapsible>
  </Card>;
}
