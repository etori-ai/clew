import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import {
  COMPETENCE_KINDS,
  type CompetenceKind,
  type CompetenceMergePreview,
  type CompetenceType,
  type CompetenceValidityImpact,
  type SessionUser,
} from '@clew/contracts';
import {
  Badge,
  Button,
  Card,
  Dialog,
  DialogHeader,
  EmptyState,
  FormLayout,
  HStack,
  List,
  ListItem,
  NumberInput,
  Pagination,
  Section,
  Selector,
  Switch,
  Table,
  Text,
  TextInput,
  Toolbar,
  Typeahead,
  TypeaheadItem,
  VStack,
  createStaticSource,
  pixel,
  proportional,
  useMediaQuery,
  type SearchableItem,
} from '@clew/ui';
import { api } from '../../api';
import { ApiError } from '../../api-error';
import { competenceCatalogueQuery, competenceMergePreviewQuery } from '../../queries';
import { keys } from '../../query-keys';
import { errorMessage } from '../../query-policy';
import { useAdminAction } from '../../mutations';
import { usePageTitle } from '../../page-title';
import { DialogFrame } from '../../components/dialog-frame';
import { PageHeader } from '../../components/page-header';
import { mobileQuery } from '../../components/shell';
import { AdminShell } from './shell';
import { SOURCES_PATH } from './competence-sources';
import { REQUIREMENTS_PATH } from './competence-requirements';
import { IMPORT_PATH } from './competence-import';

/**
 * "Kompetens" (D108 items 2, 3 and 8): the catalogue of competence types, kept by whoever has `admin.competence`. A
 * type has a name, an area it is listed under, a kind and, where the employer sets one, how many months a holding is
 * valid from the day it was issued. A type is added and changed in a dialog over the list, named in the address
 * (`?type=new`, `?type=<id>`, D83), and archived there: an archived type takes no new holdings, is required of nobody
 * and keeps the ones it has, so it is asked for twice; "Återställ" brings it back.
 *
 * The catalogue at scale (D120 item 7, D108 item 2): many types come in from a file on Importera
 * (`/admin/competence/import`), so the list is searched and paged in the browser. Two types that are one are merged in
 * the dialog ("Slå ihop med …"): the other type is chosen by searching, the server says in numbers what moves (holdings,
 * requirements, share targets, the sources' mappings) and the second press merges. A merge is not undone: the type
 * merged away is archived, says what it went into, and can be neither changed nor restored.
 *
 * A change of the validity applies at once to every holding counted from the rule. Before it is saved the page asks
 * the server what it would do and says how many holdings it turns expired; the second press saves.
 *
 * A skill (D120) is held at a level and never ends, so the validity is not asked for a type of the kind Färdighet: the
 * fields for it go when that kind is chosen, and a type made into a skill loses its rule. Whether a type may become a
 * skill, or stop being one, is the server's to say (not while anything is held of it or required of anyone).
 *
 * The page is refused while the module is switched off under Anslutna system, and to an administrator without the
 * capability; it says which and where to go.
 */
const TYPE_PARAM = 'type';
const NEW = 'new';
const NAME_MAX = 120;
const AREA_MAX = 80;
const MONTHS_MAX = 600;
export const kindLabel: Record<CompetenceKind, string> = {
  certificate: 'Certifikat',
  degree: 'Examen',
  course: 'Kurs',
  authorisation: 'Behörighet',
  skill: 'Färdighet',
};
/** "24 månader (2 år)", "18 månader"; no rule reads "Ingen regel", and a skill, which never ends, "Går inte ut". */
const validityText = (months: number | undefined, kind?: CompetenceKind) =>
  kind === 'skill'
    ? 'Går inte ut'
    : months
      ? months % 12 === 0
        ? `${months} månader (${months / 12} år)`
        : `${months} månader`
      : 'Ingen regel';
const holdingsText = (n: number) => `${n} intyg`;
const peopleText = (n: number) => `${n} ${n === 1 ? 'person' : 'personer'}`;
/** The catalogue's page: a full ESCO import is some 14 000 types, never all drawn. */
const PAGE = 50;
interface Row extends Record<string, unknown> {
  id: string;
  t: CompetenceType;
}
const editHref = (id: string) => `/admin/competence?${TYPE_PARAM}=${encodeURIComponent(id)}`;
/** What a merge would move, in the sentence the dialog says before the second press (D108 item 2). */
function mergeText(p: CompetenceMergePreview, into: string): string {
  const moves = [
    p.holdings ? `${holdingsText(p.holdings)} hos ${peopleText(p.people)}` : null,
    p.requirements
      ? `${p.requirements} krav${
          p.requirementsFolded
            ? ` (${p.requirementsFolded} slås ihop med krav som redan finns, det strängaste behålls)`
            : ''
        }`
      : null,
    p.shareTargets
      ? `${p.shareTargets} andelsmål${
          p.shareTargetsFolded ? ` (${p.shareTargetsFolded} slås ihop, den högsta andelen behålls)` : ''
        }`
      : null,
    p.mappings ? `${p.mappings} ${p.mappings === 1 ? 'koppling' : 'kopplingar'} till källor` : null,
  ].filter((m): m is string => m !== null);
  const listed =
    moves.length === 0
      ? `Inga intyg, krav eller kopplingar flyttas till ${into}.`
      : `Till ${into} flyttas ${moves.length === 1 ? moves[0] : `${moves.slice(0, -1).join(', ')} och ${moves.at(-1)}`}.`;
  return [
    listed,
    p.skillsSetAside
      ? `${peopleText(p.skillsSetAside)} har båda färdigheterna: den som väger tyngst behålls och den andra läggs undan.`
      : null,
    p.ruled ? `${holdingsText(p.ruled)} räknas efter giltighetstiden för ${into} i stället.` : null,
    p.waiting
      ? `${p.waiting === 1 ? 'En person har' : `${p.waiting} personer har`} en egen registrering av båda som väntar på godkännande. Slå ihop dem när registreringarna är granskade.`
      : 'Det går inte att ångra. Tryck Slå ihop för att genomföra det.',
  ]
    .filter(Boolean)
    .join(' ');
}

/** A type the merge may go into, as the search lists it: its name, with its area beside. */
type Target = SearchableItem<{ area: string }>;

/**
 * Adding or changing one type. `type` is undefined for a new one. The fields are filled from the type each time the
 * dialog opens for another one; what is missing is said on its field when Spara is pressed. A type that is not merged
 * may be merged into another of the same kind of thing ("Slå ihop med …", D108 item 2); an archived one may be restored;
 * a merged one says what it went into and is otherwise read only.
 */
function TypeDialog({
  type,
  isNew,
  catalogue,
  onClose,
}: {
  type: CompetenceType | undefined;
  isNew: boolean;
  catalogue: readonly CompetenceType[];
  onClose: () => void;
}) {
  const mobile = useMediaQuery(mobileQuery);
  const open = isNew || !!type;
  const save = useAdminAction({
    invalidate: [keys.competenceAll, keys.entities.all, keys.viewAll],
    toastId: 'competence:type',
  });
  const [name, setName] = useState('');
  const [area, setArea] = useState('');
  const [kind, setKind] = useState<CompetenceKind>('certificate');
  const [ruled, setRuled] = useState(false);
  const [months, setMonths] = useState<number | null>(null);
  const [tried, setTried] = useState(false);
  /** What the server said a new validity would do; shown until the person saves or changes the validity again. */
  const [impact, setImpact] = useState<CompetenceValidityImpact | null>(null);
  const [archiving, setArchiving] = useState(false);
  /** Choosing the type to merge into, and the one chosen (D108 item 2). */
  const [merging, setMerging] = useState(false);
  const [target, setTarget] = useState<Target | null>(null);
  const nameField = useRef<HTMLInputElement>(null);
  const areaField = useRef<HTMLInputElement>(null);
  const monthsField = useRef<HTMLInputElement>(null);
  const mergeButton = useRef<HTMLButtonElement>(null);
  /** Set when the merge is left with Avbryt: the focus goes back to what opened it once it is drawn again. */
  const backToMerge = useRef(false);
  const key = isNew ? NEW : (type?.id ?? null);
  useEffect(() => {
    setName(type?.name ?? '');
    setArea(type?.area ?? '');
    setKind(type?.kind ?? 'certificate');
    setRuled(!!type?.validityMonths);
    setMonths(type?.validityMonths ?? null);
    setTried(false);
    setImpact(null);
    setArchiving(false);
    setMerging(false);
    setTarget(null);
    save.reset();
    // Filled once per opened type: a refetch of the list while the dialog is open must not undo what is being typed.
  }, [key]);
  useEffect(() => {
    if (merging || !backToMerge.current) return;
    backToMerge.current = false;
    mergeButton.current?.focus();
  }, [merging]);
  const merged = type?.mergedInto ? catalogue.find(t => t.id === type.mergedInto) : undefined;
  // Into a type in use, of the same side of the line between a skill and every other kind, never into itself.
  const source = useMemo(
    () =>
      createStaticSource<Target>(
        type
          ? catalogue
              .filter(t => t.id !== type.id && !t.archived && (t.kind === 'skill') === (type.kind === 'skill'))
              .map(t => ({ id: t.id, label: t.name, auxiliaryData: { area: t.area } }))
          : [],
      ),
    [catalogue, type],
  );
  const preview = useQuery({
    ...competenceMergePreviewQuery(type?.id ?? '', target?.id ?? ''),
    enabled: merging && !!type && !!target,
  });
  const trimmedName = name.replace(/\s+/g, ' ').trim();
  const trimmedArea = area.replace(/\s+/g, ' ').trim();
  const nameProblem = !trimmedName
    ? 'Ange ett namn.'
    : trimmedName.length > NAME_MAX
      ? `Högst ${NAME_MAX} tecken.`
      : null;
  const areaProblem = !trimmedArea
    ? 'Ange ett område.'
    : trimmedArea.length > AREA_MAX
      ? `Högst ${AREA_MAX} tecken.`
      : null;
  // A skill has no validity (D120 item 1): its fields are not drawn, and its rule is none.
  const skill = kind === 'skill';
  const monthsProblem =
    !skill && ruled && (months === null || !Number.isInteger(months) || months < 1 || months > MONTHS_MAX)
      ? `Ange antal månader, 1 till ${MONTHS_MAX}.`
      : null;
  const validity = ruled && !skill ? months : null;
  const validityChanged = !!type && (type.validityMonths ?? null) !== validity;
  const submit = async () => {
    if (save.busy) return;
    if (nameProblem || areaProblem || monthsProblem) {
      setTried(true);
      (nameProblem ? nameField : areaProblem ? areaField : monthsField).current?.focus();
      return;
    }
    await save.run(async () => {
      if (!type) {
        await api.competence.addType({ name: trimmedName, area: trimmedArea, kind, validityMonths: validity });
        onClose();
        return `${trimmedName} finns nu i katalogen.`;
      }
      // A new validity moves every holding counted from the rule: the server says what it does before it is saved. A
      // type made into a skill has nothing held of it, which the server checks, so there is nothing to count.
      if (validityChanged && !impact && !skill) {
        setImpact(await api.competence.validityImpact(type.id, validity));
        return;
      }
      await api.competence.updateType(type.id, {
        name: trimmedName,
        area: trimmedArea,
        kind,
        ...(validityChanged ? { validityMonths: validity } : {}),
      });
      onClose();
      return `${trimmedName} är ändrad.`;
    });
  };
  const archive = async () => {
    if (save.busy || !type) return;
    if (!archiving) {
      setArchiving(true);
      return;
    }
    await save.run(async () => {
      await api.competence.archiveType(type.id);
      onClose();
      return `${type.name} är arkiverad.`;
    });
  };
  const restore = async () => {
    if (save.busy || !type) return;
    await save.run(async () => {
      await api.competence.restoreType(type.id);
      onClose();
      return `${type.name} är återställd och kan registreras igen.`;
    });
  };
  const merge = async () => {
    if (save.busy || !type || !target || !preview.data || preview.data.waiting) return;
    await save.run(async () => {
      await api.competence.mergeTypes(type.id, target.id);
      onClose();
      return `${type.name} är sammanslagen med ${target.label}.`;
    });
  };
  const leaveMerge = () => {
    backToMerge.current = true;
    setMerging(false);
    setTarget(null);
    save.reset();
  };
  const status = (problem: string | null) =>
    tried && problem ? { status: { type: 'error' as const, message: problem } } : {};
  const onOpenChange = (next: boolean) => {
    if (!next) onClose();
  };
  const becomesExpired = impact ? impact.expiredAfter - impact.expiredBefore : 0;
  const previewError = preview.isError ? errorMessage(preview.error, 'Det gick inte att räkna vad som flyttas.') : null;
  const footer = merged
    ? { secondary: undefined, primary: <Button size="sm" variant="primary" label="Stäng" onClick={onClose} /> }
    : merging
      ? {
          secondary: undefined,
          primary: (
            <>
              <Button size="sm" variant="ghost" label="Avbryt" onClick={leaveMerge} />
              <Button
                size="sm"
                variant="primary"
                label="Slå ihop"
                isLoading={save.busy}
                isDisabled={!preview.data || preview.data.waiting > 0}
                tooltip={
                  !target
                    ? 'Välj först vilken kompetens den ska slås ihop med.'
                    : preview.data?.waiting
                      ? 'Registreringar som väntar på godkännande måste granskas först.'
                      : undefined
                }
                onClick={() => void merge()}
              />
            </>
          ),
        }
      : {
          secondary: type ? (
            <HStack gap={2} wrap="wrap">
              {type.archived ? (
                <Button
                  size="sm"
                  variant="ghost"
                  label="Återställ"
                  isDisabled={save.busy}
                  onClick={() => void restore()}
                />
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  label={archiving ? 'Ja, arkivera' : 'Arkivera'}
                  isDisabled={save.busy}
                  onClick={() => void archive()}
                />
              )}
              <Button
                ref={mergeButton}
                size="sm"
                variant="ghost"
                label="Slå ihop med …"
                isDisabled={save.busy}
                onClick={() => {
                  setArchiving(false);
                  save.reset();
                  setMerging(true);
                }}
              />
            </HStack>
          ) : undefined,
          primary: (
            <>
              <Button size="sm" variant="ghost" label="Avbryt" onClick={onClose} />
              <Button
                size="sm"
                variant="primary"
                label={impact ? 'Spara ändringen' : 'Spara'}
                isLoading={save.busy}
                onClick={() => void submit()}
              />
            </>
          ),
        };
  return (
    <Dialog
      isOpen={open}
      onOpenChange={onOpenChange}
      width={520}
      purpose="form"
      variant={mobile ? 'fullscreen' : 'standard'}
    >
      <DialogFrame
        header={
          <DialogHeader
            title={isNew ? 'Lägg till kompetens' : merging ? 'Slå ihop kompetens' : 'Ändra kompetens'}
            subtitle={type?.name}
            onOpenChange={onOpenChange}
          />
        }
        error={save.error ?? (merging ? previewError : null)}
        secondary={footer.secondary}
        primary={footer.primary}
      >
        {merged || type?.mergedInto ? (
          <VStack gap={3}>
            <Text as="p">
              {merged
                ? `Kompetensen är sammanslagen med ${merged.name}. Intygen, kraven och kopplingarna som hörde till den finns nu där. En sammanslagning går inte att ångra.`
                : 'Kompetensen är sammanslagen med en annan. En sammanslagning går inte att ångra.'}
            </Text>
            {merged && (
              <HStack>
                <Button size="sm" variant="secondary" label={`Öppna ${merged.name}`} href={editHref(merged.id)} />
              </HStack>
            )}
          </VStack>
        ) : merging && type ? (
          <VStack gap={3}>
            <Text as="p">
              {`Allt som hör till ${type.name} flyttas till den kompetens du väljer: intyg och färdigheter, krav, andelsmål och kopplingar till källor. ${type.name} arkiveras och visar vart den gick.`}
            </Text>
            <Typeahead<Target>
              label="Slå ihop med"
              description={
                type.kind === 'skill'
                  ? 'En färdighet slås ihop med en annan färdighet som används.'
                  : 'Välj en kompetens som används. En färdighet går inte att välja.'
              }
              placeholder="Sök kompetens"
              searchSource={source}
              value={target}
              onChange={setTarget}
              hasEntriesOnFocus
              hasAutoFocus
              debounceMs={0}
              emptySearchText="Ingen kompetens som används heter så"
              renderItem={item => <TypeaheadItem item={item} description={item.auxiliaryData?.area} />}
            />
            {target && preview.isPending && <Text type="supporting">Räknar vad som flyttas …</Text>}
            {target && preview.data && (
              <Text as="p" role="status">
                {mergeText(preview.data, target.label)}
              </Text>
            )}
          </VStack>
        ) : (
          <VStack gap={3}>
            {type?.archived && (
              <Text as="p" type="supporting">
                Kompetensen är arkiverad: den kan inte registreras och krävs inte av någon, men de intyg som finns
                ligger kvar. Återställ den för att använda den igen.
              </Text>
            )}
            <FormLayout direction="vertical" defaultOptionality="required">
              <TextInput
                ref={nameField}
                label="Namn"
                description="Som den ska läsas i listor och formulär, till exempel Heta arbeten."
                value={name}
                onChange={setName}
                autoComplete="off"
                {...status(nameProblem)}
              />
              <TextInput
                ref={areaField}
                label="Område"
                description="Rubriken kompetensen listas under, till exempel Säkerhet."
                value={area}
                onChange={setArea}
                autoComplete="off"
                {...status(areaProblem)}
              />
              <Selector
                label="Typ"
                options={COMPETENCE_KINDS.map(k => ({ value: k, label: kindLabel[k] }))}
                value={kind}
                onChange={value => {
                  if (!value) return;
                  setKind(value as CompetenceKind);
                  setImpact(null);
                }}
                presentation="adaptive"
              />
              {skill ? (
                <Text as="p" type="supporting">
                  En färdighet anges med en nivå: Grundläggande, Självständig eller Expert. Den går inte ut, så den har
                  ingen giltighetstid.
                </Text>
              ) : (
                <Switch
                  label="Arbetsgivaren bestämmer giltighetstiden"
                  description="Slå på när intyget ska förnyas med ett visst mellanrum och utfärdaren inte anger något slutdatum."
                  value={ruled}
                  onChange={next => {
                    setRuled(next);
                    setImpact(null);
                  }}
                />
              )}
              {ruled && !skill && (
                <NumberInput
                  ref={monthsField}
                  label="Giltigt i"
                  units="månader"
                  value={months}
                  onChange={value => {
                    setMonths(value);
                    setImpact(null);
                  }}
                  min={1}
                  max={MONTHS_MAX}
                  isIntegerOnly
                  isWheelEnabled={false}
                  {...status(monthsProblem)}
                />
              )}
            </FormLayout>
            {impact && (
              <Text as="p" role="status">
                {impact.holdings === 0
                  ? 'Inga intyg räknas efter den här regeln ännu, så ingenting ändras för någon.'
                  : `${holdingsText(impact.holdings)} räknas efter regeln. ${
                      becomesExpired > 0
                        ? `Med ändringen blir ${becomesExpired} av dem utgångna i dag.`
                        : becomesExpired < 0
                          ? `Med ändringen blir ${-becomesExpired} av dem giltiga igen.`
                          : 'Inget av dem byter status i dag.'
                    } Tryck Spara ändringen för att genomföra den.`}
              </Text>
            )}
            {archiving && (
              <Text as="p" role="status">
                En arkiverad kompetens kan inte registreras och krävs inte av någon förrän den återställs. Intygen som
                finns ligger kvar. Tryck Ja, arkivera för att arkivera den.
              </Text>
            )}
          </VStack>
        )}
      </DialogFrame>
    </Dialog>
  );
}

export function AdminCompetencePage({ user }: { user: SessionUser }) {
  usePageTitle('Kompetens');
  const mobile = useMediaQuery(mobileQuery);
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const query = useQuery(competenceCatalogueQuery);
  const types = query.data?.rows ?? [];
  const opened = search.get(TYPE_PARAM);
  const editing = opened && opened !== NEW ? types.find(t => t.id === opened) : undefined;
  const refused = query.error instanceof ApiError && query.error.status === 403;
  const error = query.isError && !refused ? errorMessage(query.error, 'Katalogen kunde inte läsas.') : null;
  const close = () => navigate('/admin/competence');
  const active = types.filter(t => !t.archived).length;
  const byId = useMemo(() => new Map(types.map(t => [t.id, t])), [types]);
  // Searched and paged in the browser: an imported classification is thousands of types (D120 item 7).
  const [typed, setTyped] = useState('');
  const words = typed.replace(/\s+/g, ' ').trim().toLowerCase();
  const matching = useMemo(
    () =>
      words ? types.filter(t => t.name.toLowerCase().includes(words) || t.area.toLowerCase().includes(words)) : types,
    [types, words],
  );
  const [page, setPage] = useState(1);
  const pages = Math.max(1, Math.ceil(matching.length / PAGE));
  const current = Math.min(page, pages);
  const shown = matching.slice((current - 1) * PAGE, current * PAGE);
  /** The mark a type that takes nothing new carries: archived, or merged into another, which it names. */
  const mark = (t: CompetenceType) =>
    t.mergedInto ? (
      <VStack gap={1} hAlign="start">
        <Badge variant="neutral" label="Sammanslagen" />
        <Text type="supporting">{`med ${byId.get(t.mergedInto)?.name ?? 'en annan kompetens'}`}</Text>
      </VStack>
    ) : t.archived ? (
      <Badge variant="neutral" label="Arkiverad" />
    ) : null;
  const columns = [
    {
      key: 'name',
      header: 'Kompetens',
      width: proportional(3, { minWidth: 220 }),
      renderCell: (r: Row) => (
        <VStack gap={1} hAlign="start">
          <Text weight="semibold">{r.t.name}</Text>
          {mark(r.t)}
        </VStack>
      ),
    },
    {
      key: 'area',
      header: 'Område',
      width: proportional(2, { minWidth: 160 }),
      renderCell: (r: Row) => <Text>{r.t.area}</Text>,
    },
    { key: 'kind', header: 'Typ', width: pixel(140), renderCell: (r: Row) => <Text>{kindLabel[r.t.kind]}</Text> },
    {
      key: 'validity',
      header: 'Giltighet',
      width: proportional(2, { minWidth: 160 }),
      renderCell: (r: Row) => (
        <Text color={r.t.validityMonths ? 'primary' : 'secondary'}>{validityText(r.t.validityMonths, r.t.kind)}</Text>
      ),
    },
    {
      key: 'edit',
      header: 'Ändra',
      width: pixel(110),
      renderCell: (r: Row) => (
        <Button size="sm" variant="secondary" label="Ändra" aria-label={`Ändra ${r.t.name}`} href={editHref(r.t.id)} />
      ),
    },
  ];
  return (
    <AdminShell user={user} section="kompetens" crumbs={[{ label: 'Kompetens' }]} pending={query.isPending}>
      <PageHeader
        title="Kompetens"
        meta={
          <Text as="p" color="secondary">
            Katalogen över kompetenser och intyg som en chef kan registrera för sina medarbetare. Här bestämmer du vad
            som finns att välja och hur länge ett intyg gäller när arbetsgivaren sätter regeln.
          </Text>
        }
        end={
          !refused && query.data ? (
            <HStack gap={2} wrap="wrap">
              <Button variant="secondary" label="Krav" href={REQUIREMENTS_PATH} />
              <Button variant="secondary" label="Källor" href={SOURCES_PATH} />
              <Button variant="secondary" label="Importera" href={IMPORT_PATH} />
              <Button variant="primary" label="Lägg till kompetens" href={editHref(NEW)} />
            </HStack>
          ) : undefined
        }
      />
      {error && (
        <Text as="p" role="alert" color="accent">
          {error}
        </Text>
      )}
      {refused && (
        <Card>
          <EmptyState
            headingLevel={2}
            title="Katalogen är inte tillgänglig för dig"
            description={`${errorMessage(query.error, 'Du saknar behörighet för åtgärden.')} Kompetens slås på under Anslutna system, och katalogen kräver behörigheten Administrera kompetenskatalogen.`}
            actions={<Button label="Till Anslutna system" href="/admin/connectors" />}
          />
        </Card>
      )}
      {query.data && (
        <Card padding={0}>
          <Toolbar
            label="Katalogen"
            size="sm"
            dividers={['bottom']}
            startContent={
              <VStack gap={0}>
                <Text weight="semibold">Katalogen</Text>
                <Text type="supporting" role="status">
                  {types.length === 0
                    ? 'Inga kompetenser ännu'
                    : `${active} ${active === 1 ? 'kompetens' : 'kompetenser'} att registrera${types.length > active ? `, ${types.length - active} arkiverade` : ''}`}
                </Text>
              </VStack>
            }
          />
          {types.length > 0 && (
            <Section variant="transparent" padding={3}>
              <HStack gap={3} wrap="wrap" vAlign="center">
                <HStack role="search" aria-label="Sök i katalogen" width={mobile ? '100%' : 280}>
                  <TextInput
                    label="Sök kompetens"
                    isLabelHidden
                    type="search"
                    size="sm"
                    width="100%"
                    placeholder="Namn eller område"
                    startIcon="search"
                    hasClear
                    value={typed}
                    onChange={value => {
                      setTyped(value);
                      setPage(1);
                    }}
                  />
                </HStack>
                {/* What the search found, read out when it changes (4.1.3); nothing while nothing is searched for. */}
                <Text type="supporting" role="status">
                  {words ? `${matching.length} av ${types.length} matchar sökningen` : ''}
                </Text>
              </HStack>
            </Section>
          )}
          {types.length === 0 ? (
            <EmptyState
              isCompact
              headingLevel={2}
              title="Katalogen är tom"
              description="Lägg till den första kompetensen, så kan en chef registrera intyg för den. Många på en gång läses in från en fil under Importera."
            />
          ) : matching.length === 0 ? (
            <EmptyState
              isCompact
              headingLevel={2}
              title="Ingen kompetens matchar"
              description="Ändra sökningen för att se fler kompetenser."
            />
          ) : mobile ? (
            <List aria-label="Katalogen" hasDividers>
              {shown.map(t => (
                <ListItem
                  key={t.id}
                  label={<Text weight="semibold">{t.name}</Text>}
                  description={
                    <VStack gap={1} hAlign="start">
                      <Text type="supporting">
                        {t.area} · {kindLabel[t.kind]} · {validityText(t.validityMonths, t.kind)}
                      </Text>
                      {mark(t)}
                    </VStack>
                  }
                  endContent={
                    <Button
                      size="sm"
                      variant="secondary"
                      label="Ändra"
                      aria-label={`Ändra ${t.name}`}
                      href={editHref(t.id)}
                    />
                  }
                />
              ))}
            </List>
          ) : (
            <Table<Row>
              data={shown.map(t => ({ id: t.id, t }))}
              idKey="id"
              columns={columns}
              density="balanced"
              hasHover
              {...(matching.length > PAGE
                ? { rowIndexStart: (current - 1) * PAGE + 1, rowCount: matching.length }
                : {})}
            />
          )}
          {matching.length > PAGE && (
            <Section variant="transparent" padding={3}>
              <HStack justify="center">
                <Pagination
                  label="Sidor i katalogen"
                  size="sm"
                  variant={mobile ? 'compact' : 'pages'}
                  page={current}
                  totalItems={matching.length}
                  pageSize={PAGE}
                  onChange={setPage}
                />
              </HStack>
            </Section>
          )}
        </Card>
      )}
      <TypeDialog type={editing} isNew={!!query.data && opened === NEW} catalogue={types} onClose={close} />
    </AdminShell>
  );
}
