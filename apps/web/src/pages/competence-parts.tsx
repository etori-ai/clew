import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { CompetenceMatrixCell, CompetenceMatrixRow, CompetenceType } from '@clew/contracts';
import {
  Badge,
  Button,
  Dialog,
  DialogHeader,
  FormLayout,
  Selector,
  Tab,
  TabList,
  Text,
  VStack,
  useMediaQuery,
} from '@clew/ui';
import { api } from '../api';
import { COMPETENCE_PATH, MATRIX_PATH } from '../competence-address';
import { useAdminAction } from '../mutations';
import { keys } from '../query-keys';
import { DialogFrame } from '../components/dialog-frame';
import { PageHeader } from '../components/page-header';
import { mobileQuery } from '../components/shell';

/**
 * What the pages of Kompetens share (D120 item 8): the header with the sibling pages as tabs that are links, the words
 * a cell of the matrix says, and the dialog in which a manager adds a requirement for one of their reports.
 */

/** Which page of the place is shown. */
export type CompetencePageId = 'own' | 'matrix';
/**
 * The page's header (D74): its title and its own actions on the first line; under it, where the reader has the matrix
 * too (`hasTabs`: the server answered its read, so someone reports to them), the place's pages as Astryx's navigation
 * tabs, each a link with its own address (D116), the current one marked. Someone with nobody reporting to them has one
 * page, so no tabs.
 */
export function CompetenceHeader({
  title,
  titleId,
  page,
  hasTabs,
  end,
}: {
  title: string;
  titleId: string;
  page: CompetencePageId;
  hasTabs: boolean;
  end?: ReactNode;
}) {
  return (
    <VStack gap={4}>
      <PageHeader title={title} titleId={titleId} {...(end ? { end } : {})} />
      {hasTabs && (
        <TabList hasDivider value={page} onChange={() => {}} aria-label="Kompetens">
          <Tab value="own" label="Mina kompetenser" href={COMPETENCE_PATH} />
          <Tab value="matrix" label="Medarbetare" href={MATRIX_PATH} />
        </TabList>
      )}
    </VStack>
  );
}

const day = new Intl.DateTimeFormat('sv-SE', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
/** A calendar day as a cell says it: `2027-01-10` is "10 jan. 2027". */
export const cellDay = (value: string) => day.format(new Date(value + 'T12:00:00Z'));
/**
 * Where a person stands on a column, in words (D108 item 4): what needs the manager is a badge in its tone with its word
 * (Utgånget, Saknas, Går ut snart), so the colour never says it alone (1.4.1); Giltigt is plain text; a type neither
 * held nor required is "Krävs inte" in supporting text. Under it, the day it ends, and "Krävs inte" for a holding of a
 * type that is not required of the person.
 */
export function CellStatus({ cell }: { cell: CompetenceMatrixCell }) {
  const status =
    cell.status === 'expired' ? (
      <Badge variant="error" label="Utgånget" />
    ) : cell.status === 'missing' ? (
      <Badge variant="error" label="Saknas" />
    ) : cell.status === 'expiring' ? (
      <Badge variant="warning" label="Går ut snart" />
    ) : cell.status === 'valid' ? (
      <Text>Giltigt</Text>
    ) : (
      <Text type="supporting">Krävs inte</Text>
    );
  const lines = [
    cell.expiresOn ? (cell.status === 'valid' ? `till ${cellDay(cell.expiresOn)}` : cellDay(cell.expiresOn)) : null,
    !cell.required && cell.status !== 'none' ? 'Krävs inte' : null,
  ].filter((line): line is string => !!line);
  return (
    <VStack gap={0.5} hAlign="start">
      {status}
      {lines.length > 0 && <Text type="supporting">{lines.join(' · ')}</Text>}
    </VStack>
  );
}
/** What requires the type of the person, as the cell's menu names it: "Krävs: befattning Undersköterska, eget krav". */
export function reasonWords(cell: CompetenceMatrixCell): string {
  if (!cell.through.length) return 'Krävs inte';
  return (
    'Krävs: ' +
    cell.through
      .map(r =>
        r.on === 'position' ? `befattning ${r.label ?? ''}` : r.on === 'unit' ? `enhet ${r.label ?? ''}` : 'eget krav',
      )
      .join(', ')
  );
}

/** The catalogue's types a requirement can name, grouped by area: an archived type takes nothing new. */
const typeOptions = (types: CompetenceType[]) => {
  const open = types.filter(t => !t.archived);
  return [...new Set(open.map(t => t.area))].map(area => ({
    type: 'section' as const,
    title: area,
    options: open.filter(t => t.area === area).map(t => ({ value: t.id, label: t.name })),
  }));
};

/**
 * "Lägg till krav för en person" (D108 item 6, D118): the manager requires a competence of one of their reports, the
 * person and the competence chosen in the dialog. Filled afresh each time it opens; what is missing is said on its field
 * and takes the focus; the server's refusal is an alert beside the buttons, and what was chosen stays.
 */
export function PersonRequirementDialog({
  isOpen,
  people,
  catalogue,
  onClose,
}: {
  isOpen: boolean;
  people: CompetenceMatrixRow[];
  catalogue: CompetenceType[];
  onClose: () => void;
}) {
  const mobile = useMediaQuery(mobileQuery);
  const save = useAdminAction({
    invalidate: [keys.competenceAll, keys.entities.all, keys.viewAll],
    toastId: 'competence:person-requirement',
  });
  const [personId, setPersonId] = useState<string | null>(null);
  const [typeId, setTypeId] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const personField = useRef<HTMLButtonElement>(null);
  const typeField = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    setPersonId(null);
    setTypeId(null);
    setTried(false);
    save.reset();
    // Filled once per opening: a refetch while the dialog is open must not undo the choices being made.
  }, [isOpen]);
  const types = typeOptions(catalogue);
  const count = types.reduce((n, s) => n + s.options.length, 0);
  const submit = async () => {
    if (save.busy) return;
    if (!personId || !typeId) {
      setTried(true);
      (!personId ? personField : typeField).current?.focus();
      return;
    }
    const person = people.find(p => p.personId === personId);
    const type = catalogue.find(t => t.id === typeId);
    await save.run(async () => {
      await api.competence.addRequirement({ typeId, personId });
      onClose();
      return `${type?.name ?? 'Kompetensen'} krävs nu av ${person?.name ?? 'personen'}.`;
    });
  };
  const onOpenChange = (next: boolean) => {
    if (!next) onClose();
  };
  const required = (value: string | null, message: string) =>
    tried && !value ? { status: { type: 'error' as const, message } } : {};
  return (
    <Dialog
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      width={520}
      purpose="form"
      variant={mobile ? 'fullscreen' : 'standard'}
    >
      <DialogFrame
        header={<DialogHeader title="Lägg till krav för en person" onOpenChange={onOpenChange} />}
        error={save.error}
        primary={
          <>
            <Button size="sm" variant="ghost" label="Avbryt" onClick={onClose} />
            <Button size="sm" variant="primary" label="Spara" isLoading={save.busy} onClick={() => void submit()} />
          </>
        }
      >
        <FormLayout direction="vertical" defaultOptionality="required">
          <Selector
            ref={personField}
            label="Medarbetare"
            placeholder="Välj medarbetare"
            options={people.map(p => ({ value: p.personId, label: p.name }))}
            value={(personId ?? undefined) as never}
            onChange={value => setPersonId(value || null)}
            presentation="adaptive"
            hasSearch={people.length > 8}
            searchPlaceholder="Sök medarbetare"
            emptySearchText="Ingen medarbetare matchar"
            emptyText="Du är inte chef för någon"
            {...required(personId, 'Välj en medarbetare.')}
          />
          <Selector
            ref={typeField}
            label="Kompetens"
            description="Kravet gäller bara den här personen. Det som krävs av en befattning eller en enhet sätts under Administration."
            placeholder="Välj kompetens"
            options={types}
            value={(typeId ?? undefined) as never}
            onChange={value => setTypeId(value || null)}
            presentation="adaptive"
            hasSearch={count > 8}
            searchPlaceholder="Sök kompetens"
            emptySearchText="Ingen kompetens matchar"
            emptyText="Katalogen är tom"
            {...required(typeId, 'Välj en kompetens.')}
          />
        </FormLayout>
      </DialogFrame>
    </Dialog>
  );
}
