import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import {
  COMPETENCE_KINDS,
  type CompetenceKind,
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
  Selector,
  Switch,
  Table,
  Text,
  TextInput,
  Toolbar,
  VStack,
  pixel,
  proportional,
  useMediaQuery,
} from '@clew/ui';
import { api } from '../../api';
import { ApiError } from '../../api-error';
import { competenceCatalogueQuery } from '../../queries';
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

/**
 * "Kompetens" (D108 items 2, 3 and 8): the catalogue of competence types, kept by whoever has `admin.competence`. A
 * type has a name, an area it is listed under, a kind and, where the employer sets one, how many months a holding is
 * valid from the day it was issued. A type is added and changed in a dialog over the list, named in the address
 * (`?type=new`, `?type=<id>`, D83), and archived there: an archived type takes no new holdings and keeps the ones it
 * has, and there is no way back from it, so it is asked for twice.
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
interface Row extends Record<string, unknown> {
  id: string;
  t: CompetenceType;
}
const editHref = (id: string) => `/admin/competence?${TYPE_PARAM}=${encodeURIComponent(id)}`;

/**
 * Adding or changing one type. `type` is undefined for a new one. The fields are filled from the type each time the
 * dialog opens for another one; what is missing is said on its field when Spara is pressed.
 */
function TypeDialog({
  type,
  isNew,
  onClose,
}: {
  type: CompetenceType | undefined;
  isNew: boolean;
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
  const nameField = useRef<HTMLInputElement>(null);
  const areaField = useRef<HTMLInputElement>(null);
  const monthsField = useRef<HTMLInputElement>(null);
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
    save.reset();
    // Filled once per opened type: a refetch of the list while the dialog is open must not undo what is being typed.
  }, [key]);
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
  const status = (problem: string | null) =>
    tried && problem ? { status: { type: 'error' as const, message: problem } } : {};
  const onOpenChange = (next: boolean) => {
    if (!next) onClose();
  };
  const becomesExpired = impact ? impact.expiredAfter - impact.expiredBefore : 0;
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
            title={isNew ? 'Lägg till kompetens' : 'Ändra kompetens'}
            subtitle={type?.name}
            onOpenChange={onOpenChange}
          />
        }
        error={save.error}
        secondary={
          type && !type.archived ? (
            <Button
              size="sm"
              variant="ghost"
              label={archiving ? 'Arkivera, det går inte att ångra' : 'Arkivera'}
              isDisabled={save.busy}
              onClick={() => void archive()}
            />
          ) : undefined
        }
        primary={
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
        }
      >
        <VStack gap={3}>
          {type?.archived && (
            <Text as="p" type="supporting">
              Kompetensen är arkiverad: den kan inte registreras, men de intyg som finns ligger kvar.
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
              En arkiverad kompetens kan inte registreras igen och kan inte tas tillbaka. Intygen som finns ligger kvar.
            </Text>
          )}
        </VStack>
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
  const columns = [
    {
      key: 'name',
      header: 'Kompetens',
      width: proportional(3, { minWidth: 220 }),
      renderCell: (r: Row) => (
        <VStack gap={1} hAlign="start">
          <Text weight="semibold">{r.t.name}</Text>
          {r.t.archived && <Badge variant="neutral" label="Arkiverad" />}
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
          {types.length === 0 ? (
            <EmptyState
              isCompact
              headingLevel={2}
              title="Katalogen är tom"
              description="Lägg till den första kompetensen, så kan en chef registrera intyg för den."
            />
          ) : mobile ? (
            <List aria-label="Katalogen" hasDividers>
              {types.map(t => (
                <ListItem
                  key={t.id}
                  label={<Text weight="semibold">{t.name}</Text>}
                  description={
                    <VStack gap={1} hAlign="start">
                      <Text type="supporting">
                        {t.area} · {kindLabel[t.kind]} · {validityText(t.validityMonths, t.kind)}
                      </Text>
                      {t.archived && <Badge variant="neutral" label="Arkiverad" />}
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
              data={types.map(t => ({ id: t.id, t }))}
              idKey="id"
              columns={columns}
              density="balanced"
              hasHover
            />
          )}
        </Card>
      )}
      <TypeDialog type={editing} isNew={!!query.data && opened === NEW} onClose={close} />
    </AdminShell>
  );
}
