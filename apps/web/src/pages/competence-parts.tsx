import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  COMPETENCE_LEVEL_LABELS,
  competenceNeedsAttention,
  statusLabel,
  type CompetenceLevel,
  type CompetenceMatrixCell,
  type CompetenceMatrixRow,
  type CompetenceType,
  type SessionUser,
} from '@clew/contracts';
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
import { COMPETENCE_PATH, MATRIX_PATH, SEARCH_PATH } from '../competence-address';
import { useAdminAction } from '../mutations';
import { keys } from '../query-keys';
import { refused } from '../query-policy';
import { DialogFrame } from '../components/dialog-frame';
import { longDay, shortDay } from '../components/panel-labels';
import { LevelField, isSkillType, levelLabel } from '../components/register-holding';
import { PageHeader } from '../components/page-header';
import { mobileQuery } from '../components/shell';

/**
 * What the pages of Kompetens share (D120 item 8): the header with the sibling pages as tabs that are links, what a cell
 * of the matrix draws and says, and the dialog in which a manager adds a requirement for one of their reports.
 */

/** Which page of the place is shown. */
export type CompetencePageId = 'own' | 'matrix' | 'search';
/** The tab pressed on the page before, so the page it leads to gives it the focus once drawn (`CompetenceHeader`). */
let pressedTab: CompetencePageId | null = null;
/**
 * The page's header (D74): its title and its own actions on the first line; under it, where the reader has another page
 * of the place, the place's pages as Astryx's navigation tabs, each a link with its own address (D116), the current one
 * marked: the matrix where the reader has it (`hasTabs`, `managesFrom`), and Kompetenssökning where they hold the
 * relation `registrar` (`hasSearch`, D121). Someone with neither has one page, so no tabs. Each tab is named as the page
 * it leads to is headed, so the two never disagree.
 *
 * Each tab is a page of its own, so a press draws a new page, which would leave the focus nowhere (the review of
 * 2026-11-13). The focus goes where Att göra's tabs leave it, on the tab that was pressed, now the current one: the
 * pressed tab is remembered for the next page, whose header gives its tab the focus once it is drawn, also when the
 * tabs come a moment after the page (the matrix's while the server answers who reports to the reader).
 */
export function CompetenceHeader({
  title,
  titleId,
  page,
  hasTabs,
  hasSearch = false,
  end,
}: {
  title: string;
  titleId: string;
  page: CompetencePageId;
  hasTabs: boolean;
  hasSearch?: boolean;
  end?: ReactNode;
}) {
  // The current page's tab, once drawn, takes the focus when it was pressed on the page before.
  const current = useCallback(
    (el: HTMLElement | null) => {
      if (!el || pressedTab !== page) return;
      pressedTab = null;
      requestAnimationFrame(() => el.focus());
    },
    [page],
  );
  const tab = (value: CompetencePageId, label: string, href: string) => (
    <Tab value={value} label={label} href={href} {...(value === page ? { ref: current } : {})} />
  );
  return (
    <VStack gap={4}>
      <PageHeader title={title} titleId={titleId} {...(end ? { end } : {})} />
      {(hasTabs || hasSearch) && (
        <TabList
          hasDivider
          value={page}
          onChange={value => {
            if (value !== page) pressedTab = value as CompetencePageId;
          }}
          aria-label="Kompetens"
        >
          {tab('own', COMPETENCE_PAGE_TITLES.own, COMPETENCE_PATH)}
          {hasTabs && tab('matrix', COMPETENCE_PAGE_TITLES.matrix, MATRIX_PATH)}
          {hasSearch && tab('search', COMPETENCE_PAGE_TITLES.search, SEARCH_PATH)}
        </TabList>
      )}
    </VStack>
  );
}
/**
 * Each page's heading, which its tab says too (the review of 2026-11-13: the tab "Medarbetare" stood over the heading
 * "Medarbetarnas kompetens"). The matrix's is the short word, so the place's tabs fit a 320 px window side by side
 * (1.4.10) under the place the rail and the tabs' own name already say: Kompetens.
 */
export const COMPETENCE_PAGE_TITLES: Readonly<Record<CompetencePageId, string>> = {
  own: 'Mina kompetenser',
  matrix: 'Medarbetare',
  search: 'Kompetenssökning',
};

/**
 * Whether the reader has the matrix, someone reporting to them (D99): the server's answer to the matrix's read decides,
 * a refusal meaning no. Until it has answered, the session's role stands in for it, so the place's tabs are drawn with
 * the page and never gain a tab between two others when the answer comes; the rare reader whose role and reports
 * disagree sees the tab come or go once.
 */
export function managesFrom(
  user: Pick<SessionUser, 'role'>,
  matrix: { isPending: boolean; isSuccess: boolean; isError: boolean; error: unknown },
): boolean {
  if (matrix.isPending) return user.role === 'manager';
  return matrix.isSuccess || (matrix.isError && !refused(matrix.error));
}

/**
 * A day as a row of Kompetens says it, short: `2027-01-10` is "10 jan. 2027" (the one rule for a day's length is
 * written where the two formats live, `panel-labels.ts`: short in a row, long in a sentence or among one record's
 * facts, so a dialog's facts use `factDay`).
 */
export const cellDay = shortDay;
/** A day among one record's facts or in a sentence, long: "10 januari 2027". An instant is the day it falls on. */
export const factDay = longDay;
/** An instant as the day it falls on where the reader is, among a record's facts: "3 mars 2026". */
export const instantDay = longDay;
/** A holding that never ends, said one way wherever its end would stand (the review of 2026-11-13). */
export const UNTIL_FURTHER_NOTICE = 'Tills vidare';
/** Until when a holding is valid, in a row: its last day, or "Tills vidare" for one that never ends. */
export const untilWords = (expiresOn: string | undefined) => (expiresOn ? cellDay(expiresOn) : UNTIL_FURTHER_NOTICE);
/** The least levels a skill's column asks of the people shown (D120 item 4): "Minst Självständig", "Minst A eller B". */
export function levelsWords(levels: readonly number[]): string {
  const words = levels.map(levelLabel);
  return 'Minst ' + (words.length < 2 ? (words[0] ?? '') : `${words.slice(0, -1).join(', ')} eller ${words.at(-1)}`);
}

/** A level as a cell says it beside another word: "Självständig". */
const level = (value: number | undefined) => (value === undefined ? '' : levelLabel(value));
/**
 * Where a person stands on one column (D108 item 4, D120 items 1 to 4), in the words the cell's menu titles itself with
 * and its control is named by, each a phrase of its own: "Går ut snart, 10 jan. 2027", "Saknas", "Krävs inte" and what
 * is held without being required, a skill's level ("Självständig", "Egen bedömning: Expert") and, where a requirement
 * is not met, what is asked and what is held; "Att granska" first where the person's own registration waits for the
 * manager (D108 item 7), the status after it being what it is without the registration; "Vill utveckla" last.
 */
export function cellPhrases(cell: CompetenceMatrixCell, skill: boolean): string[] {
  const ends = cell.expiresOn ? cellDay(cell.expiresOn) : null;
  const held = (): string[] => {
    if (skill) {
      if (cell.level === undefined) return [];
      return [cell.validated ? level(cell.level) : `Egen bedömning: ${level(cell.level)}`];
    }
    return cell.status === 'expired'
      ? [ends ? `${statusLabel('expired')} ${ends}` : statusLabel('expired')]
      : cell.status === 'expiring'
        ? [ends ? `${statusLabel('expiring')}, ${ends}` : statusLabel('expiring')]
        : cell.status === 'valid'
          ? [ends ? `${statusLabel('valid')} till ${ends}` : `${statusLabel('valid')} tills vidare`]
          : [];
  };
  const standing =
    cell.status === 'missing'
      ? [
          statusLabel('missing'),
          ...(skill && cell.least !== undefined ? [`Kräver ${level(cell.least)}`] : []),
          ...(skill && cell.level !== undefined
            ? [cell.validated ? `Har ${level(cell.level)}` : `Egen bedömning: ${level(cell.level)}`]
            : []),
        ]
      : cell.status === 'none'
        ? ['Krävs inte']
        : cell.required
          ? held()
          : ['Krävs inte', ...held()];
  return [...(cell.pending ? ['Att granska'] : []), ...standing, ...(cell.interest ? ['Vill utveckla'] : [])];
}
/** A level's word keeps its capital inside a sentence, as "kräver Självständig" does. */
const LEVEL_WORDS = new Set<string>(Object.values(COMPETENCE_LEVEL_LABELS));
/** The phrases as one line under a sentence's opening: "går ut snart, 10 jan. 2027", "Expert, vill utveckla". */
export const cellSentence = (phrases: readonly string[]) =>
  phrases.map(p => (LEVEL_WORDS.has(p) ? p : p.charAt(0).toLocaleLowerCase('sv') + p.slice(1))).join(', ');
/**
 * What a cell's control draws (D108 item 11, D120): one short word, so a column is as narrow as its longest. What needs
 * the manager is a badge in its tone with its word (Att granska, Saknas, Utgånget, Går ut snart), so the colour never
 * says it alone (1.4.1); a required holding that is valid is the word Giltigt, or a skill's level, in the badges' size;
 * anything not required of the person is "Krävs inte" in supporting text, drawn quietly. The words are the register's
 * (`statusLabel`). The levels and the rest are the control's name and its menu's (`cellPhrases`); the day a required
 * holding runs out soon stands under the control (`cellDue`), since "Går ut snart" alone does not say when.
 */
export function CellMark({ cell, skill }: { cell: CompetenceMatrixCell; skill: boolean }) {
  if (cell.pending) return <Badge variant="info" label="Att granska" />;
  if (cell.status === 'missing') return <Badge variant="error" label={statusLabel('missing')} />;
  if (!cell.required || cell.status === 'none') return <Text type="supporting">Krävs inte</Text>;
  if (cell.status === 'expired') return <Badge variant="error" label={statusLabel('expired')} />;
  if (cell.status === 'expiring') return <Badge variant="warning" label={statusLabel('expiring')} />;
  // In the badges' size, so the longest level ("Grundläggande") fits the column as the longest badge does.
  return (
    <Text type="supporting" color="primary">
      {skill && cell.level !== undefined ? level(cell.level) : statusLabel('valid')}
    </Text>
  );
}
/**
 * The day a cell's "Går ut snart" falls on, short ("10 jan. 2027"), where the cell draws that badge: a required holding
 * that runs out within 90 days and no registration waiting. Null anywhere else, where the word says enough or the menu
 * holds the day.
 */
export const cellDue = (cell: CompetenceMatrixCell): string | null =>
  !cell.pending && cell.required && cell.status === 'expiring' && cell.expiresOn ? cellDay(cell.expiresOn) : null;
/** What requires the type of the person, as the cell's menu says it: "Krävs: befattning Undersköterska, eget krav". */
export function reasonWords(cell: CompetenceMatrixCell): string | null {
  if (!cell.through.length) return null;
  return (
    'Krävs: ' +
    cell.through
      .map(r =>
        r.on === 'position' ? `befattning ${r.label ?? ''}` : r.on === 'unit' ? `enhet ${r.label ?? ''}` : 'eget krav',
      )
      .join(', ')
  );
}
/**
 * Whether a cell needs the manager: the one definition the server counts with too (`competenceNeedsAttention`, the
 * product owner's of 2026-11-13): a requirement not met now or soon, or the person's own registration waiting.
 */
export const needsAttention = competenceNeedsAttention;
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
 * person and the competence chosen in the dialog, and for a skill the least level (D120 item 4), Grundläggande unless
 * another is chosen. Filled afresh each time it opens; what is missing is said on its field and takes the focus; the
 * server's refusal is an alert beside the buttons, and what was chosen stays.
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
  const [minLevel, setMinLevel] = useState<CompetenceLevel>(1);
  const [tried, setTried] = useState(false);
  const personField = useRef<HTMLButtonElement>(null);
  const typeField = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    setPersonId(null);
    setTypeId(null);
    setMinLevel(1);
    setTried(false);
    save.reset();
    // Filled once per opening: a refetch while the dialog is open must not undo the choices being made.
  }, [isOpen]);
  const types = typeOptions(catalogue);
  const count = types.reduce((n, s) => n + s.options.length, 0);
  // A skill is required at a least level (D120 item 4), Grundläggande unless another is chosen.
  const skill = isSkillType(catalogue.find(t => t.id === typeId));
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
      await api.competence.addRequirement({ typeId, personId, ...(skill ? { minLevel } : {}) });
      onClose();
      return `${type?.name ?? 'Kompetensen'} krävs nu av ${person?.name ?? 'personen'}${skill ? ` på minst nivån ${levelLabel(minLevel)}` : ''}.`;
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
          {skill && (
            <LevelField
              label="Lägsta nivå"
              description="Kravet uppfylls av en färdighet som chefen har bekräftat på den här nivån eller högre."
              value={minLevel}
              onChange={setMinLevel}
            />
          )}
        </FormLayout>
      </DialogFrame>
    </Dialog>
  );
}
