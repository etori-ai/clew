import { useCallback, useEffect, useRef, useState, type Ref, type RefObject } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type {
  CompetencePosition,
  CompetenceRequirement,
  CompetenceShareTarget,
  CompetenceType,
  CompetenceUnit,
  SessionUser,
} from '@clew/contracts';
import {
  AlertDialog,
  Badge,
  Button,
  Card,
  Dialog,
  DialogHeader,
  EmptyState,
  FormLayout,
  Heading,
  HStack,
  List,
  ListItem,
  NumberInput,
  RadioList,
  RadioListItem,
  Selector,
  Table,
  Text,
  Toolbar,
  VStack,
  pixel,
  proportional,
  useMediaQuery,
} from '@clew/ui';
import { api } from '../../api';
import { ApiError } from '../../api-error';
import { competenceCatalogueQuery, competenceRequirementsQuery, competenceShareTargetsQuery } from '../../queries';
import { keys } from '../../query-keys';
import { errorMessage } from '../../query-policy';
import { useAdminAction } from '../../mutations';
import { usePageTitle } from '../../page-title';
import { DialogFrame } from '../../components/dialog-frame';
import { PageHeader } from '../../components/page-header';
import { mobileQuery } from '../../components/shell';
import { AdminShell } from './shell';

/**
 * "Krav" under Administration › Kompetens (D108 item 6): what the organisation requires of whom, and the share targets
 * it sets. A requirement names a competence and one position (everyone who holds it) or one unit (everyone placed on
 * it); a person with two positions is under both sets, and a person who lacks a required competence has it marked
 * "Saknas" wherever their competence is read. A share target asks that at least a share of a position's holders hold a
 * competence, on a unit and the units under it or across the whole organisation, and names nobody. A requirement on one
 * person is their manager's to set, not the administrator's (D118), and is not listed here.
 *
 * The requirements are listed by what they are set on, positions and units each as a card, and the share targets as a
 * card of their own. Each is added in a dialog over the page, named in the address (`?requirement=new`,
 * `?target=new`, D83), and removed through Astryx's confirmation, which has no address. A list that can grow is a page
 * with an address (D116), so the requirements have this page under the catalogue's. Like the catalogue it is refused
 * while the module is off and to an administrator without `admin.competence`, and says which.
 */
export const REQUIREMENTS_PATH = '/admin/competence/requirements';
const REQUIREMENT_PARAM = 'requirement';
const TARGET_PARAM = 'target';
const NEW = 'new';
const newRequirementHref = `${REQUIREMENTS_PATH}?${REQUIREMENT_PARAM}=${NEW}`;
const newTargetHref = `${REQUIREMENTS_PATH}?${TARGET_PARAM}=${NEW}`;
/** The catalogue's types that can be required, grouped by area: an archived type takes nothing new. */
const typeOptions = (types: CompetenceType[]) => {
  const open = types.filter(t => !t.archived);
  return [...new Set(open.map(t => t.area))].map(area => ({
    type: 'section' as const,
    title: area,
    options: open.filter(t => t.area === area).map(t => ({ value: t.id, label: t.name })),
  }));
};
const optionCount = (sections: ReturnType<typeof typeOptions>) => sections.reduce((n, s) => n + s.options.length, 0);
const sv = (a: string, b: string) => a.localeCompare(b, 'sv');
/** What the page says of a target: who a requirement is set on. */
const onWords = (r: Pick<CompetenceRequirement, 'on' | 'targetLabel'>) =>
  r.on === 'position' ? `dem med befattningen ${r.targetLabel}` : `dem på ${r.targetLabel}`;
const scopeWords = (t: CompetenceShareTarget) => t.unitLabel ?? 'Hela organisationen';
interface RequirementRow extends Record<string, unknown> {
  id: string;
  r: CompetenceRequirement;
  name: string;
  archived: boolean;
}
interface TargetRow extends Record<string, unknown> {
  id: string;
  t: CompetenceShareTarget;
  name: string;
  archived: boolean;
}

/** The competence a row names, and that it is archived when it is: such a requirement counts towards nothing. */
function CompetenceCell({ name, archived }: { name: string; archived: boolean }) {
  return (
    <VStack gap={1} hAlign="start">
      <Text weight="semibold">{name}</Text>
      {archived && <Badge variant="neutral" label="Arkiverad" />}
    </VStack>
  );
}
/**
 * A position or a unit a row is set on, and that it no longer exists when the provisioner has removed it: the row counts
 * towards nothing until one comes back under the same key, and stays listed so that it can be removed.
 */
function TargetCell({ label, gone }: { label: string; gone: boolean }) {
  return (
    <VStack gap={1} hAlign="start">
      <Text>{label}</Text>
      {gone && <Badge variant="warning" label="Finns inte längre" />}
    </VStack>
  );
}
/**
 * How a share target stands, as the administrator may read it: a target across the organisation is measured over it
 * once, a figure naming nobody, and only over enough people; a unit's target is read by the manager who leads it.
 */
const outcomeWords = (t: CompetenceShareTarget) =>
  t.gone
    ? 'Räknas inte'
    : t.unitId !== undefined
      ? 'Visas för enhetens chef'
      : !t.outcome
        ? 'Räknas inte'
        : 'tooFew' in t.outcome
          ? 'För få för att visas'
          : `${t.outcome.share} %, ${t.outcome.met ? 'uppfyllt' : 'inte uppfyllt'}`;

/**
 * The focus when a dialog closes (D83 rule 7), whichever way it closed: Astryx gives it back to what had it when the
 * dialog opened, which is nothing when the dialog was opened by its address, so the page's own button that opens it takes
 * it once the dialog has closed. `frame` goes on an element inside the dialog, which finds the dialog from it.
 */
function useFocusOnClose(opener: RefObject<HTMLElement | null>) {
  const [dialog, setDialog] = useState<HTMLDialogElement | null>(null);
  const frame = useCallback((el: HTMLDivElement | null) => setDialog(el?.closest('dialog') ?? null), []);
  useEffect(() => {
    if (!dialog) return;
    const closed = () => requestAnimationFrame(() => opener.current?.focus());
    dialog.addEventListener('close', closed);
    return () => dialog.removeEventListener('close', closed);
  }, [dialog, opener]);
  return frame;
}

/** Adding a requirement on a position or a unit. Filled afresh each time it opens; what is missing is said on its field. */
function RequirementDialog({
  isOpen,
  catalogue,
  positions,
  units,
  opener,
  onClose,
}: {
  isOpen: boolean;
  catalogue: CompetenceType[];
  positions: CompetencePosition[];
  units: CompetenceUnit[];
  /** The page's own button that opens the dialog: it takes the focus when the dialog closes. */
  opener: RefObject<HTMLElement | null>;
  onClose: () => void;
}) {
  const mobile = useMediaQuery(mobileQuery);
  const frame = useFocusOnClose(opener);
  const save = useAdminAction({
    invalidate: [keys.competenceAll, keys.entities.all, keys.viewAll],
    toastId: 'competence:requirement',
  });
  const [typeId, setTypeId] = useState<string | null>(null);
  const [on, setOn] = useState<'position' | 'unit'>('position');
  const [targetId, setTargetId] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const typeField = useRef<HTMLButtonElement>(null);
  const targetField = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    setTypeId(null);
    setOn('position');
    setTargetId(null);
    setTried(false);
    save.reset();
    // Filled once per opening: a refetch while the dialog is open must not undo the choices being made.
  }, [isOpen]);
  const types = typeOptions(catalogue);
  const targets =
    on === 'position'
      ? positions.map(p => ({ value: p.code, label: p.label }))
      : units.map(u => ({ value: u.id, label: u.label }));
  const submit = async () => {
    if (save.busy) return;
    if (!typeId || !targetId) {
      setTried(true);
      (!typeId ? typeField : targetField).current?.focus();
      return;
    }
    const type = catalogue.find(t => t.id === typeId);
    const target = targets.find(t => t.value === targetId);
    await save.run(async () => {
      await api.competence.addRequirement(
        on === 'position' ? { typeId, positionCode: targetId } : { typeId, unitId: targetId },
      );
      onClose();
      return `${type?.name ?? 'Kompetensen'} krävs nu av ${onWords({ on, targetLabel: target?.label ?? '' })}.`;
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
        header={<DialogHeader title="Lägg till krav" onOpenChange={onOpenChange} />}
        error={save.error}
        primary={
          <>
            <Button size="sm" variant="ghost" label="Avbryt" onClick={onClose} />
            <Button size="sm" variant="primary" label="Spara" isLoading={save.busy} onClick={() => void submit()} />
          </>
        }
      >
        <VStack gap={3} ref={frame}>
          <FormLayout direction="vertical" defaultOptionality="required">
            <Selector
              ref={typeField}
              label="Kompetens"
              placeholder="Välj kompetens"
              options={types}
              value={(typeId ?? undefined) as never}
              onChange={value => setTypeId(value || null)}
              presentation="adaptive"
              hasSearch={optionCount(types) > 8}
              searchPlaceholder="Sök kompetens"
              emptySearchText="Ingen kompetens matchar"
              emptyText="Katalogen är tom"
              {...required(typeId, 'Välj en kompetens.')}
            />
            <RadioList
              label="Gäller"
              value={on}
              onChange={value => {
                setOn(value === 'unit' ? 'unit' : 'position');
                setTargetId(null);
              }}
            >
              <RadioListItem value="position" label="En befattning" description="Alla som har befattningen." />
              <RadioListItem value="unit" label="En enhet" description="Alla som är placerade på enheten." />
            </RadioList>
            <Selector
              ref={targetField}
              label={on === 'position' ? 'Befattning' : 'Enhet'}
              placeholder={on === 'position' ? 'Välj befattning' : 'Välj enhet'}
              options={targets}
              value={(targetId ?? undefined) as never}
              onChange={value => setTargetId(value || null)}
              presentation="adaptive"
              hasSearch={targets.length > 8}
              searchPlaceholder={on === 'position' ? 'Sök befattning' : 'Sök enhet'}
              emptySearchText="Inget matchar"
              emptyText={
                on === 'position' ? 'Inga befattningar har skickats till Clew' : 'Inga enheter har någon placerad'
              }
              {...required(targetId, on === 'position' ? 'Välj en befattning.' : 'Välj en enhet.')}
            />
          </FormLayout>
        </VStack>
      </DialogFrame>
    </Dialog>
  );
}

/** Adding a share target: a competence, a position, where it applies and the least share. */
function TargetDialog({
  isOpen,
  catalogue,
  positions,
  units,
  opener,
  onClose,
}: {
  isOpen: boolean;
  catalogue: CompetenceType[];
  positions: CompetencePosition[];
  units: CompetenceUnit[];
  /** The page's own button that opens the dialog: it takes the focus when the dialog closes. */
  opener: RefObject<HTMLElement | null>;
  onClose: () => void;
}) {
  const mobile = useMediaQuery(mobileQuery);
  const frame = useFocusOnClose(opener);
  const save = useAdminAction({
    invalidate: [keys.competenceAll, keys.entities.all, keys.viewAll],
    toastId: 'competence:target',
  });
  const [typeId, setTypeId] = useState<string | null>(null);
  const [positionCode, setPositionCode] = useState<string | null>(null);
  const [scope, setScope] = useState<'organisation' | 'unit'>('organisation');
  const [unitId, setUnitId] = useState<string | null>(null);
  const [share, setShare] = useState<number | null>(null);
  const [tried, setTried] = useState(false);
  const typeField = useRef<HTMLButtonElement>(null);
  const positionField = useRef<HTMLButtonElement>(null);
  const unitField = useRef<HTMLButtonElement>(null);
  const shareField = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setTypeId(null);
    setPositionCode(null);
    setScope('organisation');
    setUnitId(null);
    setShare(null);
    setTried(false);
    save.reset();
  }, [isOpen]);
  const types = typeOptions(catalogue);
  const shareProblem =
    share === null || !Number.isInteger(share) || share < 1 || share > 100
      ? 'Ange en andel, 1 till 100 procent.'
      : null;
  const submit = async () => {
    if (save.busy) return;
    const missingUnit = scope === 'unit' && !unitId;
    if (!typeId || !positionCode || missingUnit || shareProblem) {
      setTried(true);
      if (!typeId) typeField.current?.focus();
      else if (!positionCode) positionField.current?.focus();
      else if (missingUnit) unitField.current?.focus();
      else shareField.current?.focus();
      return;
    }
    const type = catalogue.find(t => t.id === typeId);
    const position = positions.find(p => p.code === positionCode);
    const unit = scope === 'unit' ? units.find(u => u.id === unitId) : undefined;
    await save.run(async () => {
      await api.competence.addShareTarget({
        typeId,
        positionCode,
        minShare: share!,
        ...(scope === 'unit' && unitId ? { unitId } : {}),
      });
      onClose();
      return `Minst ${share} % av dem med befattningen ${position?.label ?? ''} ska ha ${type?.name ?? 'kompetensen'}${unit ? ` på ${unit.label}` : ''}.`;
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
        header={<DialogHeader title="Lägg till andelsmål" onOpenChange={onOpenChange} />}
        error={save.error}
        primary={
          <>
            <Button size="sm" variant="ghost" label="Avbryt" onClick={onClose} />
            <Button size="sm" variant="primary" label="Spara" isLoading={save.busy} onClick={() => void submit()} />
          </>
        }
      >
        <VStack gap={3} ref={frame}>
          <FormLayout direction="vertical" defaultOptionality="required">
            <Selector
              ref={typeField}
              label="Kompetens"
              placeholder="Välj kompetens"
              options={types}
              value={(typeId ?? undefined) as never}
              onChange={value => setTypeId(value || null)}
              presentation="adaptive"
              hasSearch={optionCount(types) > 8}
              searchPlaceholder="Sök kompetens"
              emptySearchText="Ingen kompetens matchar"
              emptyText="Katalogen är tom"
              {...required(typeId, 'Välj en kompetens.')}
            />
            <Selector
              ref={positionField}
              label="Befattning"
              description="Andelen räknas bland dem som har befattningen."
              placeholder="Välj befattning"
              options={positions.map(p => ({ value: p.code, label: p.label }))}
              value={(positionCode ?? undefined) as never}
              onChange={value => setPositionCode(value || null)}
              presentation="adaptive"
              hasSearch={positions.length > 8}
              searchPlaceholder="Sök befattning"
              emptySearchText="Inget matchar"
              emptyText="Inga befattningar har skickats till Clew"
              {...required(positionCode, 'Välj en befattning.')}
            />
            <RadioList
              label="Gäller"
              value={scope}
              onChange={value => {
                setScope(value === 'unit' ? 'unit' : 'organisation');
                setUnitId(null);
              }}
            >
              <RadioListItem value="organisation" label="Hela organisationen" />
              <RadioListItem value="unit" label="En enhet" description="Enheten och enheterna under den." />
            </RadioList>
            {scope === 'unit' && (
              <Selector
                ref={unitField}
                label="Enhet"
                placeholder="Välj enhet"
                options={units.map(u => ({ value: u.id, label: u.label }))}
                value={(unitId ?? undefined) as never}
                onChange={value => setUnitId(value || null)}
                presentation="adaptive"
                hasSearch={units.length > 8}
                searchPlaceholder="Sök enhet"
                emptySearchText="Inget matchar"
                emptyText="Inga enheter har någon placerad"
                {...required(unitId, 'Välj en enhet.')}
              />
            )}
            <NumberInput
              ref={shareField}
              label="Minst"
              description="Hur stor del av dem med befattningen som ska ha kompetensen."
              units="%"
              value={share}
              onChange={setShare}
              min={1}
              max={100}
              isIntegerOnly
              isWheelEnabled={false}
              {...(tried && shareProblem ? { status: { type: 'error' as const, message: shareProblem } } : {})}
            />
          </FormLayout>
        </VStack>
      </DialogFrame>
    </Dialog>
  );
}

/** One card of requirements set on one kind of target: a table on a wide screen, a list on a phone. */
function RequirementsCard({
  title,
  targetHeader,
  rows,
  empty,
  mobile,
  onRemove,
  headingRef,
}: {
  title: string;
  targetHeader: string;
  rows: RequirementRow[];
  empty: { title: string; description: string };
  mobile: boolean;
  onRemove: (row: RequirementRow) => void;
  headingRef: Ref<HTMLHeadingElement>;
}) {
  const removeButton = (row: RequirementRow) => (
    <Button
      size="sm"
      variant="secondary"
      label="Ta bort"
      aria-label={`Ta bort kravet på ${row.name} för ${onWords(row.r)}`}
      onClick={() => onRemove(row)}
    />
  );
  return (
    <Card padding={0}>
      <Toolbar
        label={title}
        size="sm"
        dividers={['bottom']}
        startContent={
          <VStack gap={0} hAlign="start">
            <Heading ref={headingRef} tabIndex={-1} level={2}>
              {title}
            </Heading>
            <Text type="supporting">{rows.length === 0 ? 'Inga krav' : `${rows.length} krav`}</Text>
          </VStack>
        }
      />
      {rows.length === 0 ? (
        <EmptyState isCompact headingLevel={3} title={empty.title} description={empty.description} />
      ) : mobile ? (
        <List aria-label={title} hasDividers>
          {rows.map(row => (
            <ListItem
              key={row.id}
              label={<Text weight="semibold">{row.r.targetLabel}</Text>}
              description={
                <HStack gap={1} wrap="wrap" vAlign="center">
                  <Text type="supporting">{row.name}</Text>
                  {row.archived && <Badge variant="neutral" label="Arkiverad" />}
                  {row.r.gone && <Badge variant="warning" label="Finns inte längre" />}
                </HStack>
              }
              endContent={removeButton(row)}
            />
          ))}
        </List>
      ) : (
        <Table<RequirementRow>
          data={rows}
          idKey="id"
          columns={[
            {
              key: 'target',
              header: targetHeader,
              width: proportional(2, { minWidth: 180 }),
              renderCell: row => <TargetCell label={row.r.targetLabel} gone={!!row.r.gone} />,
            },
            {
              key: 'competence',
              header: 'Kompetens',
              width: proportional(3, { minWidth: 200 }),
              renderCell: row => <CompetenceCell name={row.name} archived={row.archived} />,
            },
            { key: 'remove', header: 'Ta bort', width: pixel(110), renderCell: removeButton },
          ]}
          density="balanced"
          hasHover
        />
      )}
    </Card>
  );
}

export function AdminCompetenceRequirementsPage({ user }: { user: SessionUser }) {
  usePageTitle('Krav på kompetens');
  const mobile = useMediaQuery(mobileQuery);
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const query = useQuery(competenceRequirementsQuery);
  const targetsQuery = useQuery(competenceShareTargetsQuery);
  const catalogue = useQuery(competenceCatalogueQuery);
  const types = catalogue.data?.rows ?? [];
  const typeOf = (id: string) => types.find(t => t.id === id);
  const refused = query.error instanceof ApiError && query.error.status === 403;
  const error = query.isError && !refused ? errorMessage(query.error, 'Kraven kunde inte läsas.') : null;
  const targetsError = targetsQuery.isError ? errorMessage(targetsQuery.error, 'Andelsmålen kunde inte läsas.') : null;
  const catalogueError =
    catalogue.isError && !refused ? errorMessage(catalogue.error, 'Katalogen kunde inte läsas.') : null;
  const positions = query.data?.positions ?? [];
  const units = query.data?.units ?? [];
  const named = <T extends { typeId: string }>(x: T) => ({
    name: typeOf(x.typeId)?.name ?? 'Okänd kompetens',
    archived: typeOf(x.typeId)?.archived ?? false,
  });
  const requirementRows = (on: CompetenceRequirement['on']): RequirementRow[] =>
    (query.data?.rows ?? [])
      .filter(r => r.on === on)
      .map(r => ({ id: r.id, r, ...named(r) }))
      .sort((a, b) => sv(a.r.targetLabel, b.r.targetLabel) || sv(a.name, b.name) || a.id.localeCompare(b.id));
  const targetRows: TargetRow[] = (targetsQuery.data?.rows ?? [])
    .map(t => ({ id: t.id, t, ...named(t) }))
    .sort(
      (a, b) =>
        sv(a.name, b.name) ||
        sv(a.t.positionLabel, b.t.positionLabel) ||
        sv(scopeWords(a.t), scopeWords(b.t)) ||
        a.id.localeCompare(b.id),
    );
  const ready = !!query.data && !!targetsQuery.data && !!catalogue.data;
  const requirementOpener = useRef<HTMLButtonElement>(null);
  const targetOpener = useRef<HTMLButtonElement>(null);
  const close = () => navigate(REQUIREMENTS_PATH);

  // Removal is asked for through Astryx's confirmation, which has no address; a row that goes takes its button with it,
  // so the focus then goes to the heading of the card it was in (D83 rule 7).
  const removal = useAdminAction({
    invalidate: [keys.competenceAll, keys.entities.all, keys.viewAll],
    toastId: 'competence:removed',
  });
  const [removing, setRemoving] = useState<
    { kind: 'requirement'; row: RequirementRow } | { kind: 'target'; row: TargetRow } | null
  >(null);
  const positionHeading = useRef<HTMLHeadingElement>(null);
  const unitHeading = useRef<HTMLHeadingElement>(null);
  const targetHeading = useRef<HTMLHeadingElement>(null);
  const remove = async () => {
    if (!removing) return;
    const current = removing;
    let done = false;
    await removal.run(async () => {
      if (current.kind === 'requirement') await api.competence.removeRequirement(current.row.id);
      else await api.competence.removeShareTarget(current.row.id);
      done = true;
      setRemoving(null);
      return current.kind === 'requirement'
        ? `${current.row.name} krävs inte längre av ${onWords(current.row.r)}.`
        : `Andelsmålet för ${current.row.name} bland dem med befattningen ${current.row.t.positionLabel} är borttaget.`;
    });
    // Refused: the confirmation lets go, so the reason, said on the page, is not behind a modal.
    if (!done) {
      setRemoving(null);
      return;
    }
    const owner =
      current.kind === 'target' ? targetHeading : current.row.r.on === 'position' ? positionHeading : unitHeading;
    owner.current?.focus();
  };
  const removeTargetButton = (row: TargetRow) => (
    <Button
      size="sm"
      variant="secondary"
      label="Ta bort"
      aria-label={`Ta bort andelsmålet för ${row.name} bland dem med befattningen ${row.t.positionLabel}`}
      onClick={() => setRemoving({ kind: 'target', row })}
    />
  );

  return (
    <AdminShell
      user={user}
      section="kompetens"
      crumbs={[{ label: 'Kompetens', href: '/admin/competence' }, { label: 'Krav' }]}
      pending={query.isPending}
    >
      <PageHeader
        title="Krav på kompetens"
        meta={
          <Text as="p" color="secondary">
            Vad som krävs av den som har en befattning eller är placerad på en enhet, och hur stor del av en befattning
            som ska ha en kompetens. Den som saknar något som krävs får det markerat som Saknas.
          </Text>
        }
        end={
          !refused && ready ? (
            <HStack gap={2} wrap="wrap">
              <Button ref={targetOpener} variant="secondary" label="Lägg till andelsmål" href={newTargetHref} />
              <Button ref={requirementOpener} variant="primary" label="Lägg till krav" href={newRequirementHref} />
            </HStack>
          ) : undefined
        }
      />
      {error && (
        <Text as="p" role="alert" color="accent">
          {error}
        </Text>
      )}
      {catalogueError && (
        <Text as="p" role="alert" color="accent">
          {catalogueError}
        </Text>
      )}
      {removal.error && (
        <Text as="p" role="alert" color="accent">
          {removal.error}
        </Text>
      )}
      {refused && (
        <Card>
          <EmptyState
            headingLevel={2}
            title="Kraven är inte tillgängliga för dig"
            description={`${errorMessage(query.error, 'Du saknar behörighet för åtgärden.')} Kompetens slås på under Anslutna system, och kraven kräver behörigheten Administrera kompetenskatalogen.`}
            actions={<Button label="Till Anslutna system" href="/admin/connectors" />}
          />
        </Card>
      )}
      {ready && (
        <>
          <RequirementsCard
            title="Krav på befattningar"
            targetHeader="Befattning"
            rows={requirementRows('position')}
            empty={{
              title: 'Inga krav på befattningar',
              description: 'Ett krav på en befattning gäller alla som har den, var de än är placerade.',
            }}
            mobile={mobile}
            onRemove={row => setRemoving({ kind: 'requirement', row })}
            headingRef={positionHeading}
          />
          <RequirementsCard
            title="Krav på enheter"
            targetHeader="Enhet"
            rows={requirementRows('unit')}
            empty={{
              title: 'Inga krav på enheter',
              description: 'Ett krav på en enhet gäller alla som är placerade på den.',
            }}
            mobile={mobile}
            onRemove={row => setRemoving({ kind: 'requirement', row })}
            headingRef={unitHeading}
          />
          <Card padding={0}>
            <Toolbar
              label="Andelsmål"
              size="sm"
              dividers={['bottom']}
              startContent={
                <VStack gap={0} hAlign="start">
                  <Heading ref={targetHeading} tabIndex={-1} level={2}>
                    Andelsmål
                  </Heading>
                  <Text type="supporting">
                    {targetRows.length === 0 ? 'Inga andelsmål' : `${targetRows.length} andelsmål`}
                  </Text>
                </VStack>
              }
            />
            {targetRows.length === 0 ? (
              <EmptyState
                isCompact
                headingLevel={3}
                title="Inga andelsmål"
                description="Ett andelsmål säger hur stor del av dem med en befattning som ska ha en kompetens, på en enhet eller i hela organisationen."
              />
            ) : mobile ? (
              <List aria-label="Andelsmål" hasDividers>
                {targetRows.map(row => (
                  <ListItem
                    key={row.id}
                    label={<Text weight="semibold">{row.name}</Text>}
                    description={
                      <VStack gap={1} hAlign="start">
                        <Text type="supporting">
                          Minst {row.t.minShare} % av {row.t.positionLabel} · {scopeWords(row.t)}
                        </Text>
                        <Text type="supporting">{outcomeWords(row.t)}</Text>
                        {row.t.gone && <Badge variant="warning" label="Finns inte längre" />}
                      </VStack>
                    }
                    endContent={removeTargetButton(row)}
                  />
                ))}
              </List>
            ) : (
              <Table<TargetRow>
                data={targetRows}
                idKey="id"
                columns={[
                  {
                    key: 'competence',
                    header: 'Kompetens',
                    width: proportional(3, { minWidth: 200 }),
                    renderCell: row => <CompetenceCell name={row.name} archived={row.archived} />,
                  },
                  {
                    key: 'position',
                    header: 'Befattning',
                    width: proportional(2, { minWidth: 160 }),
                    renderCell: row => (
                      <TargetCell
                        label={row.t.positionLabel}
                        gone={!positions.some(p => p.code === row.t.positionCode)}
                      />
                    ),
                  },
                  {
                    key: 'scope',
                    header: 'Gäller',
                    width: proportional(2, { minWidth: 160 }),
                    renderCell: row => (
                      <TargetCell
                        label={scopeWords(row.t)}
                        gone={row.t.unitId !== undefined && !units.some(u => u.id === row.t.unitId)}
                      />
                    ),
                  },
                  {
                    key: 'share',
                    header: 'Minst',
                    width: pixel(90),
                    renderCell: row => <Text>{row.t.minShare} %</Text>,
                  },
                  {
                    key: 'outcome',
                    header: 'Utfall',
                    width: proportional(2, { minWidth: 160 }),
                    renderCell: row => <Text>{outcomeWords(row.t)}</Text>,
                  },
                  { key: 'remove', header: 'Ta bort', width: pixel(110), renderCell: removeTargetButton },
                ]}
                density="balanced"
                hasHover
              />
            )}
          </Card>
        </>
      )}
      {targetsError && !refused && (
        <Text as="p" role="alert" color="accent">
          {targetsError}
        </Text>
      )}
      <RequirementDialog
        isOpen={ready && search.get(REQUIREMENT_PARAM) === NEW}
        catalogue={types}
        positions={positions}
        units={units}
        opener={requirementOpener}
        onClose={close}
      />
      <TargetDialog
        isOpen={ready && search.get(TARGET_PARAM) === NEW}
        catalogue={types}
        positions={positions}
        units={units}
        opener={targetOpener}
        onClose={close}
      />
      <AlertDialog
        isOpen={!!removing}
        onOpenChange={open => {
          if (!open) setRemoving(null);
        }}
        title={removing?.kind === 'target' ? 'Ta bort andelsmålet?' : 'Ta bort kravet?'}
        description={
          !removing
            ? ''
            : removing.kind === 'requirement'
              ? `${removing.row.name} krävs inte längre av ${onWords(removing.row.r)}. Det som är registrerat för dem ligger kvar.`
              : `Målet att minst ${removing.row.t.minShare} % av dem med befattningen ${removing.row.t.positionLabel} ska ha ${removing.row.name} tas bort.`
        }
        actionLabel={removing?.kind === 'target' ? 'Ta bort andelsmålet' : 'Ta bort kravet'}
        cancelLabel="Avbryt"
        isActionLoading={removal.busy}
        onAction={() => void remove()}
      />
    </AdminShell>
  );
}
