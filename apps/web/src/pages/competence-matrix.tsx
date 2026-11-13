import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps, type Ref } from 'react';
import { Navigate, useLocation, useNavigate, useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  COMPETENCE_MATRIX_COLUMNS,
  SKILL_KIND,
  competenceMatrixNeeding,
  competenceNeedsAttention,
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
  DropdownMenu,
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
  Selector,
  Switch,
  Text,
  Toolbar,
  VStack,
  resolveColumnWidths,
  useMediaQuery,
} from '@clew/ui';
import { api } from '../api';
import {
  MATRIX_PATH,
  NEW,
  REQUIREMENT_PARAM,
  approvalPageHref,
  approveHref,
  approveOf,
  attentionHref,
  attentionOnly,
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
  COMPETENCE_PAGE_TITLES,
  CellMark,
  CompetenceHeader,
  PersonRequirementDialog,
  UNTIL_FURTHER_NOTICE,
  cellDay,
  cellDue,
  cellPhrases,
  cellSentence,
  factDay,
  instantDay,
  levelsWords,
  managesFrom,
  reasonWords,
} from './competence-parts';
import { CELL_WIDTH, MatrixGrid, PERSON_WIDTH, useCellMenu, type MatrixGridHandle } from './competence-matrix-grid';

/** The page's column at its widest: Astryx's comparison template caps the matrix at 1440 px, less the padding. */
const COLUMN = 1440 - 2 * 32;
/** The page's own padding on each side of the matrix, which the matrix's least width does not count. */
const PADDING = 32;
const TITLE_ID = 'matris-rubrik';
/** The table's name: the page is "Medarbetare", its first column too, so the table says what it holds. */
const TABLE_NAME = 'Medarbetarnas kompetens';
/** The least width the matrix needs as a table with this many columns, as Astryx's Table works it out. */
const matrixMinWidth = (columns: number) =>
  resolveColumnWidths([
    { key: 'person', width: PERSON_WIDTH },
    ...Array.from({ length: columns }, (_, i) => ({ key: `type-${i}`, width: CELL_WIDTH })),
  ]).tableMinWidth;
const cellKey = (personId: string, typeId: string) => personId + '\n' + typeId;
/** The key of a registration's own way in, its name, in the list of what waits, among the page's controls. */
const awaitingKey = (holdingId: string) => 'awaiting\n' + holdingId;
const AWAITING_ID = 'matris-att-granska';
type MenuItems = NonNullable<ComponentProps<typeof DropdownMenu>['items']>;
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
  /** Whether a cell draws the day a required holding runs out soon under its control: in the table, where the cell is all. */
  withDue?: boolean;
}

/**
 * One cell, one control (D108 item 11): Astryx's `DropdownMenu` on a quiet button that draws where the person stands in
 * one word (`CellMark`) and is named for the person, the competence and all of it ("Anna Lindqvist, HLR: går ut snart,
 * 10 jan. 2027"), the same words its tooltip shows a pointer. Its menu is titled with the details and what requires the
 * competence of the person, and holds what the manager can do there. "Registrera intyg" opens the registration over the
 * page with the person and the competence in the address (`register`, `competence`); "Återkalla intyget" is offered
 * where the holding that decides was registered in Clew, never for one copied from a source; "Ta bort kravet" where the
 * competence is required of the person by the manager's own requirement. Where the person's own registration of the
 * competence waits for the manager's decision (D108 item 7), "Granska" comes first and opens the decision over the page
 * with the registration in the address (`approve`). In a skill's column (D120) a skill the person holds has "Bekräfta
 * nivå" ("Ändra nivå" once confirmed), which opens the confirmation over the page with the skill in the address
 * (`validate`), in place of a registration, since a person holds one skill of a type; where none is held,
 * "Registrera färdighet". The control takes the focus back when a dialog or a confirmation opened from it closes.
 *
 * In the table (the grid) the menu is mounted only when the cell is pressed (`useCellMenu`): until then the control is
 * the same quiet button, saying it opens a menu, so six hundred cells hold one menu, not six hundred. Pressed, the menu
 * is mounted under the button, which keeps the focus, and opens, its first row taking the focus as a menu opened by
 * key does; it stays mounted, closed, until another cell is pressed. In the list every cell has its menu, as before.
 */
function CellControl({
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
  const phrases = cellPhrases(cell, skill);
  const reason = cell.required ? reasonWords(cell) : null;
  const name = `${row.name}, ${column.name}: ${cellSentence(phrases)}`;
  const menu = useCellMenu(cellKey(row.personId, column.typeId));
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const register = ctx.control(row.personId, column.typeId);
  const ref = (el: HTMLButtonElement | null) => {
    trigger.current = el;
    register(el);
  };
  // Pressed, the menu just mounted opens once, the button keeping the focus meanwhile; another cell pressed, it closes.
  useEffect(() => {
    if (!menu) return;
    if (!menu.isMounted) setOpen(false);
    else if (menu.takeOpen()) {
      trigger.current?.focus({ preventScroll: true });
      setOpen(true);
    }
  }, [menu?.isMounted]);
  const items = (): MenuItems => [
    {
      type: 'section',
      id: 'cell',
      title: [...phrases, ...(reason ? [reason] : [])].join(' · '),
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
  const button = {
    label: name,
    tooltip: name,
    size: 'sm',
    variant: 'ghost',
    children: <CellMark cell={cell} skill={skill} />,
  } as const;
  const control =
    menu && !menu.isMounted ? (
      <Button ref={ref} {...button} aria-haspopup="menu" aria-expanded={false} onClick={menu.open} />
    ) : (
      <DropdownMenu
        button={{ ref, ...button }}
        {...(menu ? { isMenuOpen: open, onOpenChange: setOpen } : {})}
        hasChevron={false}
        presentation="adaptive"
        alignment="start"
        menuWidth={280}
        items={items()}
      />
    );
  // "Går ut snart" says when under the control, short, as the column's width allows: the day is in the control's name
  // and its menu too, so it is not read twice (the cell is the control, named with it).
  const due = ctx.withDue ? cellDue(cell) : null;
  return due ? (
    <VStack gap={0} hAlign="start">
      {control}
      <Text type="supporting" aria-hidden>
        {due}
      </Text>
    </VStack>
  ) : (
    control
  );
}

/**
 * A column's heading: the competence in up to two lines, cut with its whole name a tooltip away where it is longer (its
 * cells name it in full too); for a skill (D120 item 4), the least level asked of the people shown under it.
 */
const columnHeader = (c: CompetenceMatrixColumn) => (
  <VStack gap={0}>
    <Text weight="semibold" maxLines={2} textWrap="wrap">
      {c.name}
    </Text>
    {c.levels && c.levels.length > 0 && (
      <Text type="supporting" weight="normal" maxLines={2} textWrap="wrap">
        {levelsWords(c.levels)}
      </Text>
    )}
  </VStack>
);
/**
 * The matrix as Astryx's `table-comparison` template draws one: the people down the side in a column pinned while the
 * competences scroll past it, one narrow column per competence, a grid of dividers, and each cell one control that says
 * where the person stands in a word and opens its details and actions. A grid (`MatrixGrid`): one tab stop, the arrow
 * keys between cells, the rows drawn as they come into view. The name is each row's header (1.3.1), so moving down a
 * column a screen reader names the person with each status, and leads to the person's page; the grid has a name of its
 * own, "Medarbetarnas kompetens" (the review of 2026-11-13).
 */
function MatrixTable({
  read,
  data,
  ctx,
  handle,
}: {
  read: CompetenceMatrixOutput;
  data: CompetenceMatrixOutput;
  ctx: CellContext;
  handle: Ref<MatrixGridHandle>;
}) {
  const location = useLocation();
  const cells = { ...ctx, withDue: true };
  return (
    <MatrixGrid
      read={read}
      shown={data}
      name={TABLE_NAME}
      personHeader="Medarbetare"
      renderPerson={r => (
        <Link href={personPageFrom(location.pathname, location.search, r.personId)} weight="semibold" hasUnderline>
          {r.name}
        </Link>
      )}
      renderHeader={columnHeader}
      renderCell={(r, c, cell) => <CellControl row={r} column={c} cell={cell} ctx={cells} />}
      handle={handle}
    />
  );
}

/** The phrase a cell's control draws itself where nothing is required: the list says it once, in the control. */
const NOT_REQUIRED = 'Krävs inte';
/**
 * The matrix where the table does not fit (a phone, and beside the panel where the table would not keep its columns'
 * widths), as Personal draws its rows there: one person per item, their name leading to their page (underlined, as in
 * the table), and their cells as the item's content, a short list of each competence with its details and its
 * control. What the control draws is not said again under it: a competence nothing requires of the person is one quiet
 * line, its name and the control's "Krävs inte". Narrowed to what needs the manager (`narrowed`), a person's list holds
 * only the competences that do, so a narrowed list of thirty people is not thirty times every column.
 */
function MatrixList({ data, ctx, narrowed }: { data: CompetenceMatrixOutput; ctx: CellContext; narrowed: boolean }) {
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
              <Link
                href={personPageFrom(location.pathname, location.search, row.personId)}
                weight="semibold"
                hasUnderline
              >
                {row.name}
              </Link>
            }
            description={
              <List aria-label={`Kompetens för ${row.name}`} density="compact" edge="flush">
                {data.columns.flatMap((c, i) => {
                  const cell = row.cells[i]!;
                  if (narrowed && !needsAttention(cell)) return [];
                  const said = cellPhrases(cell, c.kind === SKILL_KIND).filter(p => p !== NOT_REQUIRED);
                  return [
                    <ListItem
                      key={c.typeId}
                      align="start"
                      label={<Text>{c.name}</Text>}
                      {...(said.length ? { description: <Text type="supporting">{said.join(' · ')}</Text> } : {})}
                      endContent={<CellControl row={row} column={c} cell={cell} ctx={ctx} />}
                    />,
                  ];
                })}
              </List>
            }
          />
        ))}
      </List>
    </Card>
  );
}
/** Whether a cell needs the manager: the one definition the server counts with (`competenceNeedsAttention`). */
const needsAttention = (cell: CompetenceMatrixCell) => competenceNeedsAttention(cell);

/** The value of the choice that shows every required competence, where they all fit (`by` left out). */
const EVERY = 'every';
/**
 * The ways to narrow the matrix, both in the address, each change a step of its own, so a reload and a link show the
 * same and Back undoes a change (the review of 2026-11-13: they were rewritten in place, so Back left the page). The set
 * (D108 item 11): every required competence where they fit, else none, then each area and each position, a part of a
 * set larger than fits its own choice. And "Visa bara det som behöver åtgärdas" (`only=attention`, the definition the
 * figure on Hem counts with, `competenceNeedsAttention`), with a status that says how much is left when it is on, in
 * people: the figure on Hem counts requirements.
 */
function MatrixChoice({
  data,
  attention,
  shown,
  onChoose,
  onAttention,
}: {
  data: CompetenceMatrixOutput;
  attention: boolean;
  shown: CompetenceMatrixOutput;
  onChoose: (g: CompetenceMatrixGroup | null) => void;
  onAttention: (on: boolean) => void;
}) {
  const every = data.required <= COMPETENCE_MATRIX_COLUMNS;
  const chosen = data.groups.findIndex(g => g.by === data.by && g.part === data.part);
  const named = (g: CompetenceMatrixGroup) => (g.parts > 1 ? `${g.label} (${g.part} av ${g.parts})` : g.label);
  const count = (n: number) => (n === 1 ? '1 kompetens' : `${n} kompetenser`);
  const options = [
    ...(every
      ? [
          {
            type: 'section' as const,
            title: 'Alla',
            options: [{ value: EVERY, label: 'Alla kompetenser', description: count(data.required) }],
          },
        ]
      : []),
    ...(['area', 'position'] as const)
      .map(kind => ({
        type: 'section' as const,
        title: kind === 'area' ? 'Område' : 'Befattning',
        options: data.groups.flatMap((g, i) =>
          g.kind === kind ? [{ value: String(i), label: named(g), description: count(g.types) }] : [],
        ),
      }))
      .filter(section => section.options.length > 0),
  ];
  const people = (n: number) => (n === 1 ? '1 medarbetare' : `${n} medarbetare`);
  return (
    <HStack gap={4} wrap="wrap" vAlign="end">
      {data.groups.length > 0 && (
        <Selector
          label="Visa kompetenser för"
          description={`${data.columns.length} av ${data.required} kompetenser som krävs visas.`}
          variant="secondary"
          options={options}
          value={(chosen >= 0 ? String(chosen) : EVERY) as never}
          onChange={value => onChoose(value === EVERY ? null : (data.groups[Number(value)] ?? null))}
          presentation="adaptive"
          hasSearch={data.groups.length > 8}
          searchPlaceholder="Sök område eller befattning"
          emptySearchText="Inget matchar"
        />
      )}
      <VStack gap={1} hAlign="start">
        <Switch
          label="Visa bara det som behöver åtgärdas"
          description="Krav som saknas, har gått ut eller går ut snart, och registreringar att granska."
          value={attention}
          onChange={next => onAttention(next)}
        />
        {/* How much is left, read out when it changes (4.1.3); nothing while the matrix is not narrowed. */}
        <Text type="supporting" role="status">
          {attention
            ? `${shown.rows.length} av ${people(data.rows.length)} och ${shown.columns.length} av ${count(data.columns.length)} visas.`
            : ''}
        </Text>
      </VStack>
    </HStack>
  );
}

/** A registration's days as a row says them: "Utfärdat 1 okt. 2026 · Giltigt till 1 okt. 2028", or "Giltigt tills vidare". */
const awaitingDays = (a: CompetenceMatrixAwaiting) =>
  [
    `Utfärdat ${cellDay(a.issuedOn)}`,
    a.expiresOn ? `Giltigt till ${cellDay(a.expiresOn)}` : `Giltigt ${UNTIL_FURTHER_NOTICE.toLocaleLowerCase('sv')}`,
  ].join(' · ');
/**
 * Every registration of the reader's reports' own that waits for their decision (D108 item 7), above the matrix: a type
 * nobody requires has no column, so this list is where each is within reach whatever its type. Astryx's card with a
 * toolbar and a list, as the person's own page draws what waits, the count in the toolbar told as it changes; each row
 * the person, the competence and its dates. The person's name leads to the person, as a person's name does everywhere
 * (the review of 2026-11-13); the registration's own way in is "Granska" at the row's end, named with the competence
 * and the person, which opens the decision over the page (`approve`) and takes the focus back when the decision is
 * left without one.
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
  control: (key: string) => (el: HTMLAnchorElement | HTMLButtonElement | null) => void;
  onReview: (row: CompetenceMatrixAwaiting) => void;
}) {
  const location = useLocation();
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
            label={
              <Link
                href={personPageFrom(location.pathname, location.search, row.personId)}
                weight="semibold"
                hasUnderline
              >
                {row.name}
              </Link>
            }
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
              {/* One record's facts: a day is long here, as a detail writes it. */}
              <MetadataListItem label="Utfärdat">{factDay(approval.issuedOn)}</MetadataListItem>
              <MetadataListItem label="Giltigt till">
                {approval.expiresOn ? factDay(approval.expiresOn) : UNTIL_FURTHER_NOTICE}
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
 * `COMPETENCE_MATRIX_COLUMNS` columns at a time; the reader narrows them to a set by area or by position, which is
 * chosen for them where more are required, and to what needs them (`only=attention`), both in the address (`by`,
 * `part`, `only`). Each cell is one control that says where the person stands in a word, never by colour alone, is
 * named with all of it, and opens its details and a menu that
 * registers a certificate with the competence chosen (`register`, `competence`), revokes a holding registered in Clew
 * and removes the manager's own requirement on the person, each removal asked for in Astryx's confirmation first. The
 * header adds a requirement for one person in a dialog named in the address (`requirement=new`) and downloads the
 * matrix as shown as a file. Every registration of the reports' own that waits for the reader's decision (D108 item 7)
 * is listed above the matrix, whatever its type, and one of a required type is noted in its cell too; either opens the
 * decision in a dialog named in the address (`approve`), as the approval's card in the reader's stream does, and a
 * decision replaces the address so Back does not come to it again; an address for a registration the reader may not
 * decide, or one decided already, opens nothing and the page says why. A skill's cell (D120) says the level held and
 * its menu confirms it in a dialog named in the address (`validate`), which an address the reader may not confirm opens
 * nothing of, as for an approval. Closing a dialog or a confirmation gives the focus back to the cell's control, or to
 * the page's heading where the cell has gone with what was removed or where no cell opened it (D83 rule 7). The table
 * gives way to a list where it does not fit, on a phone and beside the panel, as Personal does, so at 320 px nothing
 * scrolls sideways; on a wider window the table scrolls sideways inside its own region, the names pinned, as the
 * template's does, and is a grid of one tab stop whose rows and columns are drawn as they come into view
 * (`MatrixGrid`).
 */
export function CompetenceMatrixPage({ user, admin }: { user: SessionUser; admin: boolean }) {
  usePageTitle(COMPETENCE_PAGE_TITLES.matrix);
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
  const read = matrixQ.data;
  const off = matrixQ.isError && refused(matrixQ.error);
  // What needs the manager, narrowed on the page from what the read answered (`only=attention`).
  const attention = attentionOnly(search);
  const data = useMemo(() => (read && attention ? competenceMatrixNeeding(read) : read), [read, attention]);
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
    (key: string) => (el: HTMLAnchorElement | HTMLButtonElement | null) => {
      if (el) controls.current.set(key, el);
      else controls.current.delete(key);
    },
    [],
  );
  // The grid, which gives a cell the focus itself: its row may not be drawn until it is scrolled to.
  const grid = useRef<MatrixGridHandle>(null);
  /** Gives the cell's control the focus, in the grid or in the list; false where the page shows no such cell. */
  const focusCell = useCallback((personId: string, typeId: string) => {
    if (grid.current?.focusCell(personId, typeId)) return true;
    const control = controls.current.get(cellKey(personId, typeId));
    if (!control?.isConnected) return false;
    control.focus();
    return true;
  }, []);
  // Where the focus goes when a registration closes: the cell's control, or, where no cell is (an address from before
  // that names a competence not shown, or none), the page's heading (D83 rule 7). The cell is given the focus here, so
  // nothing is returned for it.
  const opener = useCallback(
    (personId: string, typeId: string | null) =>
      typeId && focusCell(personId, typeId) ? null : document.getElementById(TITLE_ID),
    [focusCell],
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
      const awaiting = focusAfter.startsWith(awaitingKey(''));
      if (focusAfter !== REQUIREMENT_PARAM && !awaiting) {
        const [personId, typeId] = focusAfter.split('\n');
        if (personId && typeId && focusCell(personId, typeId)) return;
      }
      const control = focusAfter === REQUIREMENT_PARAM ? addRequirement.current : controls.current.get(focusAfter);
      const list = awaiting ? awaitingHeading.current : null;
      [control, list, document.getElementById(TITLE_ID)].find(t => t?.isConnected)?.focus();
    });
  }, [focusAfter, data, matrixQ.isFetching, requiring, approving, validating, focusCell]);

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
   * Closed, decided or not, the address is replaced, so Back never comes to the decision again (the review of
   * 2026-11-13: Back reopened a write dialog). Without a decision the focus goes back at once; after one, `decide`
   * gives it back once the page has been read again (the control that opened it may have gone with the registration).
   */
  const closeApproval = (wasDecided = false) => {
    if (approving) client.removeQueries({ queryKey: keys.competenceApproval(approving) });
    decision.reset();
    navigate(withoutApprove(search), { replace: true });
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
    // Replaced, so Back never opens the confirmation again (D83 rule 8).
    navigate(withoutValidate(search), { replace: true });
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
  // A choice of columns, or the narrowing, is a step of its own, so Back undoes it (the review of 2026-11-13).
  const choose = (g: CompetenceMatrixGroup | null) =>
    navigate(matrixHref(g ? { by: g.by, part: g.part } : {}, search), { preventScrollReset: true });
  const narrowTo = (on: boolean) => navigate(attentionHref(on, search), { preventScrollReset: true });

  const shown = read && read.rows.length > 0 && read.columns.length > 0;
  // The file holds what the page shows (the set, and narrowed when the page is), and its button says how many people.
  const filed = data?.rows.length ?? 0;
  const actions =
    read && !off ? (
      <HStack gap={2} wrap="wrap">
        {shown && filed > 0 && (
          <Button
            variant="secondary"
            label={`Ladda ner ${filed === 1 ? '1 medarbetare' : `${filed} medarbetare`} som CSV`}
            icon={<Icon icon={ArrowDownTrayIcon} size="sm" />}
            href={matrixFileHref(read.by ? { by: read.by, ...(read.part ? { part: read.part } : {}) } : {}, attention)}
          />
        )}
        {read.rows.length > 0 && (
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
                  title={COMPETENCE_PAGE_TITLES.matrix}
                  titleId={TITLE_ID}
                  page="matrix"
                  hasTabs={!off && managesFrom(user, matrixQ)}
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
                    {read && read.awaiting.length > 0 && (
                      <Awaiting
                        rows={read.awaiting}
                        search={search}
                        headingRef={awaitingHeading}
                        control={awaitingControl}
                        onReview={row => {
                          reviewedFrom.current = awaitingKey(row.holdingId);
                        }}
                      />
                    )}
                    {read && read.rows.length === 0 ? (
                      <Card>
                        <EmptyState
                          headingLevel={2}
                          title="Inga medarbetare att visa"
                          description="Här ser den som är chef för en enhet sina medarbetares kompetens. Katalogen avgör vem som är chef; be systemförvaltaren om det inte stämmer."
                        />
                      </Card>
                    ) : read && read.columns.length === 0 ? (
                      <Card>
                        <EmptyState
                          headingLevel={2}
                          title="Inget krävs av dina medarbetare"
                          description="När en befattning, en enhet eller du kräver en kompetens av någon av dem visas den här, med var var och en står."
                        />
                      </Card>
                    ) : read && data ? (
                      <>
                        <MatrixChoice
                          data={read}
                          attention={attention}
                          shown={data}
                          onChoose={choose}
                          onAttention={narrowTo}
                        />
                        {data.rows.length === 0 ? (
                          <Card>
                            <EmptyState
                              headingLevel={2}
                              title="Inget behöver åtgärdas"
                              description="Inget som krävs av dem som visas saknas, har gått ut eller går ut snart, och ingen registrering väntar på granskning."
                              actions={<Button label="Visa alla" href={attentionHref(false, search)} />}
                            />
                          </Card>
                        ) : (
                          <VStack gap={0} aria-busy={matrixQ.isPlaceholderData}>
                            {narrow ? (
                              <MatrixList data={data} ctx={ctx} narrowed={attention} />
                            ) : (
                              <MatrixTable read={read} data={data} ctx={ctx} handle={grid} />
                            )}
                          </VStack>
                        )}
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
      <RegisterHolding opener={opener} people={read?.rows.map(r => ({ id: r.personId, name: r.name }))} />
      <PersonRequirementDialog
        isOpen={!!read && !off && requiring}
        people={read?.rows ?? []}
        catalogue={typesQ.data?.rows ?? []}
        onClose={() => {
          // Replaced, so Back never opens the dialog again (D83 rule 8).
          navigate(withoutRequirement(search), { replace: true });
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
