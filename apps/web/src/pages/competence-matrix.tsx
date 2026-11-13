import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps, type Ref } from 'react';
import { Navigate, useLocation, useNavigate, useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  SKILL_KIND,
  type CompetenceApproval,
  type CompetenceDecision,
  type CompetenceLevel,
  type CompetenceMatrixAwaiting,
  type CompetenceMatrixCell,
  type CompetenceMatrixColumn,
  type CompetenceMatrixGroup,
  type CompetenceMatrixOutput,
  type CompetenceMatrixRow,
  type CompetenceSkillValidation,
  type SessionUser,
} from '@clew/contracts';
import {
  AlertDialog,
  ArrowDownTrayIcon,
  Button,
  Card,
  Dialog,
  DialogHeader,
  EmptyState,
  HStack,
  Heading,
  Icon,
  Layout,
  LayoutContent,
  Link,
  List,
  ListItem,
  MetadataList,
  MetadataListItem,
  MoreMenu,
  Selector,
  Table,
  Text,
  Toolbar,
  VStack,
  pixel,
  proportional,
  resolveColumnWidths,
  type TablePlugin,
  useMediaQuery,
  useTableStickyColumns,
} from '@clew/ui';
import { api } from '../api';
import {
  MATRIX_PATH,
  NEW,
  REQUIREMENT_PARAM,
  approvalPageHref,
  approveHref,
  approveOf,
  matrixFileHref,
  matrixHref,
  matrixInputOf,
  requirementHref,
  validateHref,
  validateOf,
  withoutApprove,
  withoutRequirement,
  withoutValidate,
} from '../competence-address';
import { useAdminAction } from '../mutations';
import { usePageTitle } from '../page-title';
import { personPageFrom } from '../person-address';
import { competenceApprovalQuery, competenceMatrixQuery, competenceSkillQuery, competenceTypesQuery } from '../queries';
import { keys } from '../query-keys';
import { errorMessage, refused } from '../query-policy';
import { registerHref } from '../register-address';
import { useRail } from '../components/nav';
import { useHeldRelations } from '../capabilities';
import { Shell, mobileQuery, shortQuery } from '../components/shell';
import { AsyncContent, ContentSkeleton } from '../components/loading';
import { usePagePanel } from '../components/page-panel';
import { panelBesideQuery } from '../components/panel';
import { DialogFrame } from '../components/dialog-frame';
import { LevelField, RegisterHolding, levelLabel } from '../components/register-holding';
import {
  CellStatus,
  CompetenceHeader,
  PersonRequirementDialog,
  cellDay,
  instantDay,
  levelsWords,
  reasonWords,
} from './competence-parts';

/** The page's column at its widest: Astryx's comparison template caps the matrix at 1440 px, less the padding. */
const COLUMN = 1440 - 2 * 32;
/** The page's own padding on each side of the matrix, which the matrix's least width does not count. */
const PADDING = 32;
const TITLE_ID = 'matris-rubrik';
/** The pinned column of names, and each competence's column: as wide as a badge, its day and the cell's menu. */
const PERSON_WIDTH = pixel(220),
  CELL_WIDTH = proportional(1, { minWidth: 176 });
/** The least width the matrix needs as a table with this many columns, as Astryx's Table works it out. */
const matrixMinWidth = (columns: number) =>
  resolveColumnWidths([
    { key: 'person', width: PERSON_WIDTH },
    ...Array.from({ length: columns }, (_, i) => ({ key: `type-${i}`, width: CELL_WIDTH })),
  ]).tableMinWidth;
const cellKey = (personId: string, typeId: string) => personId + '\n' + typeId;
/** The key of a registration's own "Granska" in the list of what waits, among the page's controls. */
const awaitingKey = (holdingId: string) => 'awaiting\n' + holdingId;
const AWAITING_ID = 'matris-att-granska';
type MenuItems = ComponentProps<typeof MoreMenu>['items'];
/** A write a cell's menu asks to confirm: revoking the holding that decides, or removing the requirement on the person. */
interface Confirming {
  kind: 'revoke' | 'requirement';
  row: CompetenceMatrixRow;
  column: CompetenceMatrixColumn;
  /** The holding to revoke, or the requirement to remove. */
  id: string;
}
/**
 * What every cell needs from the page: the address it is on, its control's place, the way to ask to confirm, and the
 * way to say that it opened the decision on a registration (so the focus comes back to it).
 */
interface CellContext {
  search: URLSearchParams;
  control: (personId: string, typeId: string) => (el: HTMLButtonElement | null) => void;
  confirm: (c: Confirming) => void;
  review: (personId: string, typeId: string) => void;
}

/**
 * One cell's menu (Astryx's `MoreMenu`, as a row of the `table` template carries one): titled with what requires the
 * competence of the person, and holding what the manager can do there. "Registrera intyg" opens the registration over
 * the page with the person and the competence in the address (`register`, `competence`); "Återkalla intyget" is offered
 * where the holding that decides was registered in Clew, never for one copied from a source; "Ta bort kravet" where the
 * competence is required of the person by the manager's own requirement. Where the person's own registration of the
 * competence waits for the manager's decision (D108 item 7), "Granska" comes first and opens the decision over the page
 * with the registration in the address (`approve`). In a skill's column (D120) a skill the person holds has "Bekräfta
 * nivå" ("Ändra nivå" once confirmed), which opens the confirmation over the page with the skill in the address
 * (`validate`), in place of a registration, since a person holds one skill of a type; where none is held,
 * "Registrera färdighet". The trigger is the cell's control, which takes the focus back when a dialog or a confirmation
 * opened from it closes.
 */
function CellMenu({
  row,
  column,
  cell,
  ctx,
}: {
  row: CompetenceMatrixRow;
  column: CompetenceMatrixColumn;
  cell: CompetenceMatrixCell;
  ctx: CellContext;
}) {
  const own = cell.through.find(r => r.on === 'person' && r.requirementId)?.requirementId;
  const skill = column.kind === SKILL_KIND;
  const heldSkill = skill && cell.holdingId !== undefined && cell.level !== undefined ? cell.holdingId : null;
  const items: MenuItems = [
    {
      type: 'section',
      id: 'cell',
      title: reasonWords(cell),
      items: [
        ...(cell.pending
          ? [
              {
                id: 'review',
                label: 'Granska',
                href: approveHref(cell.pending, ctx.search),
                onClick: () => ctx.review(row.personId, column.typeId),
              },
            ]
          : []),
        heldSkill
          ? {
              id: 'validate',
              label: cell.validated ? 'Ändra nivå' : 'Bekräfta nivå',
              href: validateHref(heldSkill, ctx.search),
              onClick: () => ctx.review(row.personId, column.typeId),
            }
          : {
              id: 'register',
              label: skill ? 'Registrera färdighet' : 'Registrera intyg',
              href: registerHref(MATRIX_PATH, row.personId, ctx.search, column.typeId),
            },
        ...(cell.revocable && cell.holdingId
          ? [
              {
                id: 'revoke',
                label: skill ? 'Återkalla färdigheten' : 'Återkalla intyget',
                onClick: () => ctx.confirm({ kind: 'revoke', row, column, id: cell.holdingId! }),
              },
            ]
          : []),
        ...(own
          ? [
              {
                id: 'requirement',
                label: 'Ta bort kravet',
                onClick: () => ctx.confirm({ kind: 'requirement', row, column, id: own }),
              },
            ]
          : []),
      ],
    },
  ];
  return (
    <MoreMenu
      ref={ctx.control(row.personId, column.typeId)}
      label={`Åtgärder: ${column.name} för ${row.name}`}
      size="sm"
      alignment="end"
      presentation="adaptive"
      items={items}
    />
  );
}

/**
 * A column's heading in two lines, as Personal draws one: the competence, and its area under it; for a skill (D120 item
 * 4), the least level asked of the people shown under that.
 */
const columnHeader = (c: CompetenceMatrixColumn) => (
  <VStack gap={0}>
    <Text weight="semibold">{c.name}</Text>
    <Text type="supporting" weight="normal">
      {c.area}
    </Text>
    {c.levels && c.levels.length > 0 && (
      <Text type="supporting" weight="normal">
        {levelsWords(c.levels)}
      </Text>
    )}
  </VStack>
);
interface TableRow extends Record<string, unknown> {
  id: string;
  row: CompetenceMatrixRow;
}

/**
 * The matrix as Astryx's `table-comparison` template draws one: the people down the side in a column pinned while the
 * competences scroll past it (`useTableStickyColumns`), one column per competence, a grid of dividers, and each cell
 * the person's status in words with its menu.
 */
function MatrixTable({ data, ctx }: { data: CompetenceMatrixOutput; ctx: CellContext }) {
  const location = useLocation();
  const sticky = useTableStickyColumns<TableRow>({ startKeys: ['person'] });
  // The name is each row's header (1.3.1), so moving down a column a screen reader names the person with each status.
  // Astryx's Table draws every body cell as a `td` and has no row-header column; its documented plugin hook
  // (`transformBodyCell`) gives the name's cell the role.
  const rowHeaders = useMemo<TablePlugin<TableRow>>(
    () => ({
      transformBodyCell: (props, column) =>
        column.key === 'person' ? { ...props, htmlProps: { ...props.htmlProps, role: 'rowheader' } } : props,
    }),
    [],
  );
  return (
    <Card padding={0}>
      <Table<TableRow>
        data={data.rows.map(row => ({ id: row.personId, row }))}
        idKey="id"
        columns={[
          {
            key: 'person',
            header: 'Medarbetare',
            width: PERSON_WIDTH,
            renderCell: r => (
              <Link href={personPageFrom(location.pathname, location.search, r.row.key)} weight="semibold" hasUnderline>
                {r.row.name}
              </Link>
            ),
          },
          ...data.columns.map((c, i) => ({
            key: `type:${c.typeId}`,
            header: columnHeader(c),
            width: CELL_WIDTH,
            renderCell: (r: TableRow) => (
              <HStack gap={2} vAlign="center" justify="between">
                <CellStatus cell={r.row.cells[i]!} skill={c.kind === SKILL_KIND} />
                <CellMenu row={r.row} column={c} cell={r.row.cells[i]!} ctx={ctx} />
              </HStack>
            ),
          })),
        ]}
        density="balanced"
        dividers="grid"
        hasHover
        plugins={{ sticky, rowHeaders }}
      />
    </Card>
  );
}

/**
 * The matrix where the table does not fit (a phone, and beside the panel where the table would not keep its columns'
 * widths), as Personal draws its rows there: one person per item, their name leading to their page, and their cells as
 * the item's content, a short list of each competence with its status and its menu.
 */
function MatrixList({ data, ctx }: { data: CompetenceMatrixOutput; ctx: CellContext }) {
  const location = useLocation();
  return (
    <Card padding={0}>
      <List aria-label="Medarbetare" hasDividers>
        {data.rows.map(row => (
          <ListItem
            key={row.personId}
            itemKey={row.personId}
            align="start"
            label={
              <Link href={personPageFrom(location.pathname, location.search, row.key)} weight="semibold">
                {row.name}
              </Link>
            }
            description={
              <List aria-label={`Kompetens för ${row.name}`} density="compact" edge="flush">
                {data.columns.map((c, i) => (
                  <ListItem
                    key={c.typeId}
                    align="start"
                    label={<Text>{c.name}</Text>}
                    description={<CellStatus cell={row.cells[i]!} skill={c.kind === SKILL_KIND} />}
                    endContent={<CellMenu row={row} column={c} cell={row.cells[i]!} ctx={ctx} />}
                  />
                ))}
              </List>
            }
          />
        ))}
      </List>
    </Card>
  );
}

/**
 * The choice of the columns where more competences are required than ten (D108 item 11): the sets by area, then by
 * position, each part of a set larger than ten its own choice. A choice rewrites the address in place, as a view's own
 * controls do, so a reload and a link show the same columns and one step back leaves the page.
 */
function SetChoice({ data, onChoose }: { data: CompetenceMatrixOutput; onChoose: (g: CompetenceMatrixGroup) => void }) {
  if (!data.groups.length) return null;
  const chosen = data.groups.findIndex(g => g.by === data.by && g.part === data.part);
  const named = (g: CompetenceMatrixGroup) => (g.parts > 1 ? `${g.label} (${g.part} av ${g.parts})` : g.label);
  const options = (['area', 'position'] as const)
    .map(kind => ({
      type: 'section' as const,
      title: kind === 'area' ? 'Område' : 'Befattning',
      options: data.groups.flatMap((g, i) =>
        g.kind === kind
          ? [
              {
                value: String(i),
                label: named(g),
                description: g.types === 1 ? '1 kompetens' : `${g.types} kompetenser`,
              },
            ]
          : [],
      ),
    }))
    .filter(s => s.options.length > 0);
  return (
    <HStack>
      <Selector
        label="Visa kompetenser för"
        description={`${data.columns.length} av ${data.required} kompetenser som krävs visas.`}
        variant="secondary"
        options={options}
        value={String(chosen) as never}
        onChange={value => {
          const g = data.groups[Number(value)];
          if (g) onChoose(g);
        }}
        presentation="adaptive"
        hasSearch={data.groups.length > 8}
        searchPlaceholder="Sök område eller befattning"
        emptySearchText="Inget matchar"
      />
    </HStack>
  );
}

/** A registration's days as a row says them: "Utfärdat 1 okt. 2026 · Giltigt till 1 okt. 2028". */
const awaitingDays = (a: CompetenceMatrixAwaiting) =>
  [`Utfärdat ${cellDay(a.issuedOn)}`, a.expiresOn ? `Giltigt till ${cellDay(a.expiresOn)}` : 'Inget slutdatum'].join(
    ' · ',
  );
/**
 * Every registration of the reader's reports' own that waits for their decision (D108 item 7), above the matrix: a type
 * nobody requires has no column, so this list is where each is within reach whatever its type. Astryx's card with a
 * toolbar and a list, as the person's own page draws what waits, the count in the toolbar told as it changes; each row
 * the person, the competence and its dates, and "Granska", which opens the decision over the page (`approve`).
 */
function Awaiting({
  rows,
  search,
  headingRef,
  control,
  onReview,
}: {
  rows: CompetenceMatrixAwaiting[];
  search: URLSearchParams;
  headingRef: Ref<HTMLHeadingElement>;
  control: (key: string) => (el: HTMLButtonElement | null) => void;
  onReview: (row: CompetenceMatrixAwaiting) => void;
}) {
  return (
    <Card padding={0}>
      <Toolbar
        label="Att granska"
        size="sm"
        dividers={['bottom']}
        startContent={
          <VStack gap={0} hAlign="start">
            <Heading ref={headingRef} id={AWAITING_ID} tabIndex={-1} level={2}>
              Att granska
            </Heading>
            <Text type="supporting" role="status">
              {rows.length === 1 ? '1 registrering' : `${rows.length} registreringar`}
            </Text>
          </VStack>
        }
      />
      <List aria-labelledby={AWAITING_ID} hasDividers>
        {rows.map(row => (
          <ListItem
            key={row.holdingId}
            label={<Text weight="semibold">{row.name}</Text>}
            description={
              <VStack gap={0} hAlign="start">
                <Text>{row.competence}</Text>
                <Text type="supporting">{awaitingDays(row)}</Text>
              </VStack>
            }
            endContent={
              <Button
                ref={control(awaitingKey(row.holdingId))}
                size="sm"
                variant="secondary"
                label="Granska"
                aria-label={`Granska ${row.competence} för ${row.name}`}
                href={approveHref(row.holdingId, search)}
                onClick={() => onReview(row)}
              />
            }
          />
        ))}
      </List>
    </Card>
  );
}

/**
 * The decision on a report's own registration (D108 item 7), a dialog over the matrix named in the address
 * (`approve=<holding id>`): who registered it, the competence and its dates, and the two decisions. "Godkänn" decides at
 * once; "Avvisa" asks first in Astryx's confirmation, which closes into this dialog. The server's refusal (decided by
 * another of the person's managers meanwhile) is said beside the buttons. Open while `approval` is given.
 */
function ApprovalDialog({
  approval,
  error,
  busy,
  onDecide,
  onClose,
}: {
  approval: CompetenceApproval | undefined;
  error: string | null;
  busy: boolean;
  onDecide: (decision: CompetenceDecision) => Promise<void>;
  onClose: () => void;
}) {
  const mobile = useMediaQuery(mobileQuery);
  const [asking, setAsking] = useState(false);
  useEffect(() => setAsking(false), [approval?.holdingId]);
  const onOpenChange = (open: boolean) => {
    if (!open) onClose();
  };
  const decide = async (decision: CompetenceDecision) => {
    await onDecide(decision);
    // Done, the page closes both; refused, the confirmation lets go and the refusal is said in the dialog.
    setAsking(false);
  };
  return (
    <>
      <Dialog
        isOpen={!!approval}
        onOpenChange={onOpenChange}
        width={480}
        purpose="form"
        variant={mobile ? 'fullscreen' : 'standard'}
      >
        <DialogFrame
          header={
            <DialogHeader
              title="Granska intyg"
              subtitle={approval ? `Registrerat av ${approval.name}` : undefined}
              onOpenChange={onOpenChange}
            />
          }
          error={error}
          secondary={<Button size="sm" variant="ghost" label="Avbryt" onClick={onClose} />}
          primary={
            <>
              <Button size="sm" variant="secondary" label="Avvisa" onClick={() => setAsking(true)} />
              <Button
                size="sm"
                variant="primary"
                label="Godkänn"
                isLoading={busy && !asking}
                onClick={() => void decide('approve')}
              />
            </>
          }
        >
          {approval && (
            <MetadataList columns="single">
              <MetadataListItem label="Medarbetare">{approval.name}</MetadataListItem>
              <MetadataListItem label="Kompetens">{approval.competence}</MetadataListItem>
              <MetadataListItem label="Område">{approval.area}</MetadataListItem>
              <MetadataListItem label="Utfärdat">{cellDay(approval.issuedOn)}</MetadataListItem>
              <MetadataListItem label="Giltigt till">
                {approval.expiresOn ? cellDay(approval.expiresOn) : 'Inget slutdatum'}
              </MetadataListItem>
              <MetadataListItem label="Registrerat">{instantDay(approval.registeredAt)}</MetadataListItem>
            </MetadataList>
          )}
        </DialogFrame>
      </Dialog>
      <AlertDialog
        isOpen={!!approval && asking}
        onOpenChange={open => {
          if (!open) setAsking(false);
        }}
        title="Avvisa intyget?"
        description={
          approval
            ? `${approval.competence} för ${approval.name} räknas inte, och ${approval.name} ser att det är avvisat.`
            : ''
        }
        actionLabel="Avvisa intyget"
        cancelLabel="Avbryt"
        isActionLoading={busy}
        onAction={() => void decide('reject')}
      />
    </>
  );
}

/**
 * The confirmation of a report's skill (D120 item 2), a dialog over the matrix named in the address
 * (`validate=<holding id>`): who holds it, which skill, the level they or a manager set and whether it is their own
 * rating, and the level to confirm, preset to the one held. "Bekräfta nivå" confirms it at the level chosen; for a
 * skill already confirmed the dialog and its button are "Ändra nivå", as the cell's menu row that opens it. The
 * server's refusal is said beside the buttons. Open while `skill` is given.
 */
function SkillDialog({
  skill,
  error,
  busy,
  onConfirm,
  onClose,
}: {
  skill: CompetenceSkillValidation | undefined;
  error: string | null;
  busy: boolean;
  onConfirm: (level: CompetenceLevel) => Promise<void>;
  onClose: () => void;
}) {
  const mobile = useMediaQuery(mobileQuery);
  const [level, setLevel] = useState<CompetenceLevel | null>(null);
  useEffect(() => setLevel(skill?.level ?? null), [skill?.holdingId, skill?.level]);
  const onOpenChange = (open: boolean) => {
    if (!open) onClose();
  };
  return (
    <Dialog
      isOpen={!!skill}
      onOpenChange={onOpenChange}
      width={480}
      purpose="form"
      variant={mobile ? 'fullscreen' : 'standard'}
    >
      <DialogFrame
        header={
          <DialogHeader
            title={skill?.validated ? 'Ändra nivå' : 'Bekräfta nivå'}
            subtitle={skill ? `${skill.competence} för ${skill.name}` : undefined}
            onOpenChange={onOpenChange}
          />
        }
        error={error}
        primary={
          <>
            <Button size="sm" variant="ghost" label="Avbryt" onClick={onClose} />
            <Button
              size="sm"
              variant="primary"
              label={skill?.validated ? 'Ändra nivå' : 'Bekräfta nivå'}
              isLoading={busy}
              onClick={() => level !== null && void onConfirm(level)}
            />
          </>
        }
      >
        {skill && (
          <VStack gap={3}>
            <MetadataList columns="single">
              <MetadataListItem label="Medarbetare">{skill.name}</MetadataListItem>
              <MetadataListItem label="Färdighet">{skill.competence}</MetadataListItem>
              <MetadataListItem label="Område">{skill.area}</MetadataListItem>
              <MetadataListItem label={skill.validated ? 'Bekräftad nivå' : 'Egen bedömning'}>
                {levelLabel(skill.level)}
              </MetadataListItem>
              {skill.interest && <MetadataListItem label="Vill utveckla">Ja</MetadataListItem>}
            </MetadataList>
            <LevelField
              description="Förvald är nivån som är registrerad nu. Välj en annan om den inte stämmer."
              value={level}
              onChange={setLevel}
            />
          </VStack>
        )}
      </DialogFrame>
    </Dialog>
  );
}

/**
 * Medarbetarnas kompetens at `/competence/matrix` (D108 item 11, D120 item 8), the second page of the place Kompetens:
 * the people who report to the reader against the competences required of at least one of them, built on Astryx's
 * `table-comparison` template. It is no declared view: its columns are chosen, and a cell writes (D95 item 4). At most
 * ten columns at a time; where more are required, the reader chooses a set by area or by position, and the set is in
 * the address (`by`, `part`). Each cell says where the person stands in words, never by colour alone, and its menu
 * registers a certificate with the competence chosen (`register`, `competence`), revokes a holding registered in Clew
 * and removes the manager's own requirement on the person, each removal asked for in Astryx's confirmation first. The
 * header adds a requirement for one person in a dialog named in the address (`requirement=new`) and downloads the
 * matrix as shown as a file. Every registration of the reports' own that waits for the reader's decision (D108 item 7)
 * is listed above the matrix, whatever its type, and one of a required type is noted in its cell too; either opens the
 * decision in a dialog named in the address (`approve`), as the approval's card in the reader's stream does, and a
 * decision replaces the address so Back does not come to it again; an address for a registration the reader may not
 * decide, or one decided already, opens nothing and the page says why. A skill's cell (D120) says the level held in words and its menu confirms it in a dialog named
 * in the address (`validate`), which an address the reader may not confirm opens nothing of, as for an approval. Closing a dialog or a confirmation gives the focus back to the cell's control, or to the
 * page's heading where the cell has gone with what was removed or where no cell opened it (D83 rule 7). The table gives way to a list where it does
 * not fit, on a phone and beside the panel, as Personal does, so at 320 px nothing scrolls sideways; on a wider window the
 * table scrolls sideways inside its own region, the names pinned, as the template's does.
 */
export function CompetenceMatrixPage({ user, admin }: { user: SessionUser; admin: boolean }) {
  usePageTitle('Medarbetarnas kompetens');
  const mobile = useMediaQuery(mobileQuery);
  const short = useMediaQuery(shortQuery);
  // The rail's Personal follows the session's role; who reports to the reader is the matrix read's answer (D99).
  const nav = useRail({ current: { surface: 'competence' }, admin, manager: user.role === 'manager' });
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const client = useQueryClient();
  // D121: Kompetenssökning is a page of the place for someone who holds the relation.
  const searcher = useHeldRelations().includes('registrar');
  const input = matrixInputOf(search);
  const matrixQ = useQuery(competenceMatrixQuery(input));
  const typesQ = useQuery(competenceTypesQuery);
  const panel = usePagePanel({ overlayOnly: short });
  const data = matrixQ.data;
  const off = matrixQ.isError && refused(matrixQ.error);
  const tableBeside = useMediaQuery(panelBesideQuery(matrixMinWidth(data?.columns.length ?? 0) + 2 * PADDING));
  const narrow = mobile || (panel.occupied && !tableBeside);

  // Each cell's control, so a dialog or a confirmation opened from it can give it the focus back.
  const controls = useRef(new Map<string, HTMLElement>());
  const control = useCallback(
    (personId: string, typeId: string) => (el: HTMLButtonElement | null) => {
      if (el) controls.current.set(cellKey(personId, typeId), el);
      else controls.current.delete(cellKey(personId, typeId));
    },
    [],
  );
  // Each "Granska" in the list of what waits, so the decision it opened can give it the focus back.
  const awaitingControl = useCallback(
    (key: string) => (el: HTMLButtonElement | null) => {
      if (el) controls.current.set(key, el);
      else controls.current.delete(key);
    },
    [],
  );
  // Where the focus goes when a registration closes: the cell's control, or, where no cell is (an address from before
  // that names a competence not shown, or none), the page's heading (D83 rule 7).
  const opener = useCallback(
    (personId: string, typeId: string | null) =>
      (typeId ? controls.current.get(cellKey(personId, typeId)) : undefined) ?? document.getElementById(TITLE_ID),
    [],
  );
  // The focus after a confirmation or the requirement's dialog, once the page has drawn what it changed: the cell's
  // control, or the header's button for the dialog, or the heading when the control has gone (with the column, or since
  // the dialog was opened by an address from before and nothing on the page opened it).
  // It waits for the dialog to have closed: the address changes after the press that closed it, and nothing under a
  // modal dialog can take the focus.
  const addRequirement = useRef<HTMLButtonElement>(null);
  const awaitingHeading = useRef<HTMLHeadingElement>(null);
  const [focusAfter, setFocusAfter] = useState<string | null>(null);
  // A registration just decided (D108 item 7): the focus waits until the page has drawn the matrix without it, since its
  // row in the list of what waits, and perhaps the list itself, goes with it.
  const decided = useRef<string | null>(null);
  const requiring = search.get(REQUIREMENT_PARAM) === NEW;
  const approving = approveOf(search);
  const validating = validateOf(search);
  useEffect(() => {
    if (focusAfter === null || requiring || approving || validating) return;
    if (decided.current && matrixQ.isFetching && data?.awaiting.some(a => a.holdingId === decided.current)) return;
    decided.current = null;
    setFocusAfter(null);
    // A frame later, once the dialogs that closed have given the focus back where they took it from; the target is
    // found then, among what the page holds at that moment. A row of what waits goes with its decision: then the
    // list's heading, while the list is there, else the page's.
    requestAnimationFrame(() => {
      const control = focusAfter === REQUIREMENT_PARAM ? addRequirement.current : controls.current.get(focusAfter);
      const list = focusAfter.startsWith(awaitingKey('')) ? awaitingHeading.current : null;
      [control, list, document.getElementById(TITLE_ID)].find(t => t?.isConnected)?.focus();
    });
  }, [focusAfter, data, matrixQ.isFetching, requiring, approving, validating]);

  // The decision on a report's own registration (D108 item 7), from a cell's menu or from the approval's card. The
  // cell that opened it takes the focus back; opened by an address, nothing on the page did, so the heading does.
  const reviewedFrom = useRef<string | null>(null);
  const approvalQ = useQuery({ ...competenceApprovalQuery(approving ?? ''), enabled: !!approving && !off });
  const [refusal, setRefusal] = useState<string | null>(null);
  useEffect(() => {
    if (approving || validating) setRefusal(null);
  }, [approving, validating]);
  // An address the reader may not decide, or one decided already, opens nothing: the page says why and lets go of it.
  useEffect(() => {
    if (!approving || !approvalQ.isError) return;
    setRefusal(errorMessage(approvalQ.error, 'Registreringen kunde inte läsas.'));
    reviewedFrom.current = null;
    navigate(withoutApprove(search), { replace: true });
  }, [approving, approvalQ.isError]);
  const decision = useAdminAction({
    // Not the approval's own read, which is let go of: the registration is decided, so it would only be refused.
    invalidate: [['competence', 'matrix'], keys.viewAll, keys.entities.all, keys.threads, keys.attention, keys.areas],
    toastId: 'competence:approval',
  });
  /**
   * Closed after a decision the address is replaced, so Back never comes to a decision already made; closed without one
   * it is a step of its own, as opening it was. Without a decision the focus goes back at once; after one, `decide`
   * gives it back once the page has been read again (the control that opened it may have gone with the registration).
   */
  const closeApproval = (wasDecided = false) => {
    if (approving) client.removeQueries({ queryKey: keys.competenceApproval(approving) });
    decision.reset();
    navigate(withoutApprove(search), wasDecided ? { replace: true } : undefined);
    const from = reviewedFrom.current ?? TITLE_ID;
    reviewedFrom.current = null;
    if (!wasDecided) setFocusAfter(from);
    return from;
  };
  const decide = async (choice: CompetenceDecision) => {
    const a = approvalQ.data;
    if (!a) return;
    // Set when the decision was made, read once its run has resolved.
    const closed: { from?: string } = {};
    await decision.run(async () => {
      await api.competence.decide(a.holdingId, choice);
      closed.from = closeApproval(true);
      return choice === 'approve'
        ? `${a.competence} är godkänt för ${a.name}.`
        : `${a.competence} är avvisat för ${a.name}.`;
    });
    // The run resolves once what the decision changed has been read again (the matrix among it): only then is it known
    // what is left on the page to take the focus.
    if (closed.from !== undefined) {
      decided.current = a.holdingId;
      setFocusAfter(closed.from);
    }
  };

  // The confirmation of a report's skill (D120 item 2), from a cell's menu or an address, as the approval is.
  const skillQ = useQuery({ ...competenceSkillQuery(validating ?? ''), enabled: !!validating && !off });
  useEffect(() => {
    if (!validating || !skillQ.isError) return;
    setRefusal(errorMessage(skillQ.error, 'Färdigheten kunde inte läsas.'));
    reviewedFrom.current = null;
    navigate(withoutValidate(search), { replace: true });
  }, [validating, skillQ.isError]);
  const validation = useAdminAction({
    invalidate: [['competence', 'matrix'], keys.viewAll, keys.entities.all, keys.attention, keys.areas],
    toastId: 'competence:validate',
  });
  const closeValidation = () => {
    if (validating) client.removeQueries({ queryKey: keys.competenceSkill(validating) });
    validation.reset();
    navigate(withoutValidate(search));
    setFocusAfter(reviewedFrom.current ?? TITLE_ID);
    reviewedFrom.current = null;
  };
  const confirmLevel = async (level: CompetenceLevel) => {
    const v = skillQ.data;
    if (!v || validation.busy) return;
    await validation.run(async () => {
      await api.competence.validateSkill(v.holdingId, { level });
      closeValidation();
      return `${v.competence} för ${v.name} är bekräftad på nivån ${levelLabel(level)}.`;
    });
  };

  const [confirming, setConfirming] = useState<Confirming | null>(null);
  const change = useAdminAction({
    invalidate: [keys.competenceAll, keys.entities.all, keys.viewAll],
    toastId: 'competence:matrix',
  });
  const cancel = () => {
    if (!confirming) return;
    setConfirming(null);
    setFocusAfter(cellKey(confirming.row.personId, confirming.column.typeId));
  };
  const confirm = async () => {
    if (!confirming) return;
    const c = confirming;
    await change.run(async () => {
      if (c.kind === 'revoke') await api.competence.revokeHolding(c.id);
      else await api.competence.removeRequirement(c.id);
      return c.kind === 'revoke'
        ? `${c.column.name} är ${c.column.kind === SKILL_KIND ? 'återkallad' : 'återkallat'} för ${c.row.name}.`
        : `${c.column.name} krävs inte längre av ${c.row.name}.`;
    });
    // Done or refused, the confirmation lets go: a refusal is said on the page, not behind a modal.
    setConfirming(null);
    setFocusAfter(cellKey(c.row.personId, c.column.typeId));
  };
  const ctx: CellContext = {
    search,
    control,
    confirm: c => {
      change.reset();
      setConfirming(c);
    },
    review: (personId, typeId) => {
      reviewedFrom.current = cellKey(personId, typeId);
    },
  };
  const choose = (g: CompetenceMatrixGroup) =>
    navigate(matrixHref({ by: g.by, part: g.part }, search), { replace: true, preventScrollReset: true });

  const shown = data && data.rows.length > 0 && data.columns.length > 0;
  const actions =
    data && !off ? (
      <HStack gap={2} wrap="wrap">
        {shown && (
          <Button
            variant="secondary"
            label="Ladda ner som CSV"
            icon={<Icon icon={ArrowDownTrayIcon} size="sm" />}
            href={matrixFileHref(data.by ? { by: data.by, ...(data.part ? { part: data.part } : {}) } : {})}
          />
        )}
        {data.rows.length > 0 && (
          <Button
            ref={addRequirement}
            variant="primary"
            label="Lägg till krav för en person"
            href={requirementHref(search)}
          />
        )}
      </HStack>
    ) : undefined;

  return (
    <Shell user={user} nav={nav} height={short ? 'auto' : 'fill'}>
      <Layout
        height={short ? 'auto' : 'fill'}
        padding={mobile ? 3 : 8}
        end={panel.end}
        content={
          <LayoutContent isScrollable={!short}>
            <VStack hAlign="center">
              <VStack gap={5} width="100%" maxWidth={COLUMN}>
                <CompetenceHeader
                  title="Medarbetarnas kompetens"
                  titleId={TITLE_ID}
                  page="matrix"
                  hasTabs={!off && !matrixQ.isPending}
                  hasSearch={searcher}
                  end={actions}
                />
                {change.error && (
                  <Text as="p" role="alert" color="accent">
                    {change.error}
                  </Text>
                )}
                {refusal && (
                  <Text as="p" role="alert" color="accent">
                    {refusal}
                  </Text>
                )}
                {off ? (
                  <Card>
                    <EmptyState
                      headingLevel={2}
                      title="Medarbetarnas kompetens visas inte för dig"
                      description={errorMessage(
                        matrixQ.error,
                        'Medarbetarnas kompetens visas för den som är chef för en enhet.',
                      )}
                      actions={<Button label="Till Mina kompetenser" href="/competence" />}
                    />
                  </Card>
                ) : matrixQ.isError ? (
                  <VStack gap={2}>
                    <Text as="p" role="alert">
                      {errorMessage(matrixQ.error, 'Medarbetarnas kompetens kunde inte läsas.')}
                    </Text>
                    <HStack>
                      <Button
                        size="sm"
                        variant="secondary"
                        label="Försök igen"
                        isLoading={matrixQ.isFetching}
                        onClick={() => void matrixQ.refetch()}
                      />
                    </HStack>
                  </VStack>
                ) : (
                  <AsyncContent pending={matrixQ.isPending} fallback={<ContentSkeleton heading={false} />} gap={5}>
                    {data && data.awaiting.length > 0 && (
                      <Awaiting
                        rows={data.awaiting}
                        search={search}
                        headingRef={awaitingHeading}
                        control={awaitingControl}
                        onReview={row => {
                          reviewedFrom.current = awaitingKey(row.holdingId);
                        }}
                      />
                    )}
                    {data && data.rows.length === 0 ? (
                      <Card>
                        <EmptyState
                          headingLevel={2}
                          title="Inga medarbetare att visa"
                          description="Här ser den som är chef för en enhet sina medarbetares kompetens. Katalogen avgör vem som är chef; be systemförvaltaren om det inte stämmer."
                        />
                      </Card>
                    ) : data && data.columns.length === 0 ? (
                      <Card>
                        <EmptyState
                          headingLevel={2}
                          title="Inget krävs av dina medarbetare"
                          description="När en befattning, en enhet eller du kräver en kompetens av någon av dem visas den här, med var var och en står."
                        />
                      </Card>
                    ) : data ? (
                      <>
                        <SetChoice data={data} onChoose={choose} />
                        <VStack gap={0} aria-busy={matrixQ.isPlaceholderData}>
                          {narrow ? <MatrixList data={data} ctx={ctx} /> : <MatrixTable data={data} ctx={ctx} />}
                        </VStack>
                      </>
                    ) : null}
                  </AsyncContent>
                )}
              </VStack>
            </VStack>
          </LayoutContent>
        }
      />
      {panel.overlay}
      {/* Registrera intyg (D108 item 7), from a cell with its competence chosen; closing gives the cell its focus back. */}
      <RegisterHolding opener={opener} people={data?.rows.map(r => ({ id: r.personId, name: r.name }))} />
      <PersonRequirementDialog
        isOpen={!!data && !off && requiring}
        people={data?.rows ?? []}
        catalogue={typesQ.data?.rows ?? []}
        onClose={() => {
          navigate(withoutRequirement(search));
          setFocusAfter(REQUIREMENT_PARAM);
        }}
      />
      <ApprovalDialog
        approval={approving && !off && !approvalQ.isError ? approvalQ.data : undefined}
        error={decision.error}
        busy={decision.busy}
        onDecide={decide}
        onClose={() => closeApproval()}
      />
      <SkillDialog
        skill={validating && !off && !skillQ.isError ? skillQ.data : undefined}
        error={validation.error}
        busy={validation.busy}
        onConfirm={confirmLevel}
        onClose={closeValidation}
      />
      <AlertDialog
        isOpen={!!confirming}
        onOpenChange={open => {
          if (!open) cancel();
        }}
        title={
          confirming?.kind === 'revoke'
            ? confirming.column.kind === SKILL_KIND
              ? 'Återkalla färdigheten?'
              : 'Återkalla intyget?'
            : 'Ta bort kravet?'
        }
        description={
          !confirming
            ? ''
            : confirming.kind === 'revoke'
              ? confirming.column.kind === SKILL_KIND
                ? `${confirming.column.name} för ${confirming.row.name} räknas inte längre. Färdigheten finns kvar, markerad som återkallad.`
                : `${confirming.column.name} för ${confirming.row.name} räknas inte längre. Intyget finns kvar, markerat som återkallat.`
              : `${confirming.column.name} krävs inte längre av ${confirming.row.name}. Det som är registrerat ligger kvar.`
        }
        actionLabel={
          confirming?.kind === 'revoke'
            ? confirming.column.kind === SKILL_KIND
              ? 'Återkalla färdigheten'
              : 'Återkalla intyget'
            : 'Ta bort kravet'
        }
        cancelLabel="Avbryt"
        isActionLoading={change.busy}
        onAction={() => void confirm()}
      />
    </Shell>
  );
}

/**
 * The page of the approval's read (`/tools/competence.approval?input={"holding":…}`, D116), which the button on a
 * manager's card of a report's own registration leads to (D108 item 7): the decision over the matrix, where the manager
 * works, named in the address (`/competence/matrix?approve=<holding id>`). It replaces the address, so Back from the
 * matrix returns to where the card was.
 */
export function ApprovalPage() {
  const { search } = useLocation();
  return <Navigate replace to={approvalPageHref(search)} />;
}
