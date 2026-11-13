import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import {
  COMPETENCE_LEVELS,
  COMPETENCE_LEVEL_DESCRIPTIONS,
  COMPETENCE_LEVEL_LABELS,
  SKILL_KIND,
  isCompetenceLevel,
  type CompetenceHoldingBody,
  type CompetenceLevel,
  type CompetenceOwnSkill,
  type CompetenceSkillRatingBody,
  type CompetenceType,
} from '@clew/contracts';
import {
  Button,
  DateInput,
  Dialog,
  DialogHeader,
  FormLayout,
  RadioList,
  RadioListItem,
  Selector,
  Switch,
  Text,
  VStack,
  useMediaQuery,
} from '@clew/ui';
import { today } from '@clew/calendar/dates';
import { api } from '../api';
import { useAdminAction } from '../mutations';
import { competenceOwnTypesQuery, competenceTypesQuery, staffQuery } from '../queries';
import { keys } from '../query-keys';
import { registerOf, registerTypeOf, withoutRegister } from '../register-address';
import { DialogFrame } from './dialog-frame';
import { mobileQuery } from './shell';

/**
 * Registering a holding (D108 item 7, D120): by the manager a person reports to, for them (`RegisterHolding`), or by the
 * person for themselves (`AddOwnHolding`). Both ask the same: which competence and, by its kind, either the day it was
 * issued and, where the issuer set one, the day it ends, or for a skill the level it is held at (`useHoldingFields`). One
 * dialog changes its fields with the kind of the competence chosen, and a sentence above them says what the chosen kind
 * means, in a status region, so the change is said as well as shown. The server computes where the holding stands; the
 * form only says what the certificate or the person says.
 *
 * The date fields take any day: a field that refused a day would drop what was typed without a word, and the form
 * would then register a certificate without the end date the person meant. A day that has not come, or an end before
 * the issue, is said on its field instead. What is missing is said on the field when the form is sent, and the focus
 * goes to the first such field. The server's sentence is an alert beside the buttons and what was chosen stays.
 */
const options = (types: CompetenceType[]) => {
  const areas = [...new Set(types.map(t => t.area))];
  return areas.map(area => ({
    type: 'section' as const,
    title: area,
    options: types.filter(t => t.area === area).map(t => ({ value: t.id, label: t.name })),
  }));
};
const months = (n: number) => (n % 12 === 0 ? `${n / 12} år` : `${n} månader`);
/** Whether a type of the catalogue is a skill (D120): held at a level, with no dates of its own. */
export const isSkillType = (type: Pick<CompetenceType, 'kind'> | undefined) => type?.kind === SKILL_KIND;
/** A level as a person reads it: "Självständig". */
export const levelLabel = (level: number) =>
  isCompetenceLevel(level) ? COMPETENCE_LEVEL_LABELS[level] : String(level);
/** The first of a group's choices, the chosen one where there is one: what takes the focus when the group is wrong. */
export function focusChoice(group: RefObject<HTMLDivElement | null>) {
  const inputs = [...(group.current?.querySelectorAll<HTMLInputElement>('input[type="radio"]') ?? [])];
  (inputs.find(i => i.checked) ?? inputs[0])?.focus();
}

/**
 * The level of a skill (D120 item 1) as one choice among three, Astryx's radio list: the group's label is drawn, each
 * level says what it means, and a wrong or missing choice is said on the group (`aria-invalid`). `groupRef` is the
 * group, whose chosen or first choice `focusChoice` focuses.
 */
export function LevelField({
  label = 'Nivå',
  description,
  value,
  onChange,
  problem,
  groupRef,
}: {
  label?: string;
  description?: string;
  value: CompetenceLevel | null;
  onChange: (level: CompetenceLevel) => void;
  /** What is wrong, said on the group; null when nothing is. */
  problem?: string | null;
  groupRef?: RefObject<HTMLDivElement | null>;
}) {
  return (
    <RadioList
      {...(groupRef ? { ref: groupRef } : {})}
      label={label}
      {...(description ? { description } : {})}
      value={value === null ? '' : String(value)}
      onChange={next => {
        const level = Number(next);
        if (isCompetenceLevel(level)) onChange(level);
      }}
      {...(problem ? { status: { type: 'error' as const, message: problem } } : {})}
    >
      {COMPETENCE_LEVELS.map(level => (
        <RadioListItem
          key={level}
          value={String(level)}
          label={COMPETENCE_LEVEL_LABELS[level]}
          description={COMPETENCE_LEVEL_DESCRIPTIONS[level]}
        />
      ))}
    </RadioList>
  );
}

/** "Vill utveckla" (D120 item 3): set by the person alone, shown where the skill is listed, counting towards nothing. */
export function InterestField({ value, onChange }: { value: boolean; onChange: (next: boolean) => void }) {
  return (
    <Switch
      label="Vill utveckla"
      description="Visas där färdigheten listas. Det påverkar inget krav."
      value={value}
      onChange={next => onChange(next)}
    />
  );
}

/**
 * Who fills the form in: the manager for a report, the person for themselves, or (`own-alone`) a person whom nobody
 * would approve a certificate for, who adds skills alone (D108 item 7, D120 item 2).
 */
export type HoldingFormMode = 'manager' | 'own' | 'own-alone';
/** What the form answers when it is right: a certificate's body with its dates, or a skill's with its level. */
export type ReadyHolding =
  | { kind: 'dated'; body: CompetenceHoldingBody; type: CompetenceType }
  | { kind: 'skill'; body: CompetenceSkillRatingBody; type: CompetenceType };
/**
 * The sentence above the fields, by who fills the form in and the kind chosen (D108 item 7, D120 item 2): a person's
 * certificate waits for the manager they report to; a person's skill is shown at once as their own rating; a manager's
 * certificate is registered with its dates and a manager's skill confirmed by them.
 */
const NOTICE: Record<HoldingFormMode, Record<'dated' | 'skill', string>> = {
  own: {
    dated: 'Din chef behöver godkänna intyget innan det räknas.',
    skill: 'Färdigheten visas direkt som din egen bedömning. Den räknas mot ett krav när din chef har bekräftat nivån.',
  },
  // Nobody would approve a certificate, so only skills are offered: before one is chosen the sentence says why.
  'own-alone': {
    dated:
      'Ingen chef är registrerad för dig, så ett intyg kan inte skickas för godkännande. En färdighet kan du lägga till: den visas direkt som din egen bedömning.',
    skill:
      'Färdigheten visas direkt som din egen bedömning. Den räknas mot ett krav först när en chef har bekräftat nivån.',
  },
  manager: {
    dated: 'Ett intyg registreras med dagen det utfärdades och, om det har ett, slutdatumet.',
    skill: 'En färdighet registreras med en nivå, som räknas som bekräftad av dig.',
  },
};

/**
 * The fields a holding is registered with, and what is wrong with them: the competence from the catalogue grouped by
 * area (starting on `preset` while it can be registered), then by its kind either the day it was issued and the day it
 * ends, or the level and, for the person's own, whether they want to develop it. `notice` is the sentence about the
 * kind chosen, a status region placed above the fields, so a change of kind is announced. `ready` says what is wrong on
 * the fields and gives the first the focus, or answers what to send; `reset` empties them.
 */
export function useHoldingFields(types: CompetenceType[], preset: string | null, mode: HoldingFormMode = 'manager') {
  // The type the person chose; until they choose, the one the address starts on, while it can be registered.
  const [picked, setTypeId] = useState<string | undefined>(undefined);
  const typeId = picked ?? (preset && types.some(t => t.id === preset) ? preset : undefined);
  const [issuedOn, setIssuedOn] = useState<string | undefined>(undefined);
  const [expiresOn, setExpiresOn] = useState<string | undefined>(undefined);
  const [level, setLevel] = useState<CompetenceLevel | null>(null);
  const [interest, setInterest] = useState(false);
  const [tried, setTried] = useState(false);
  const typeField = useRef<HTMLButtonElement>(null);
  const issuedField = useRef<HTMLInputElement>(null);
  const expiresField = useRef<HTMLInputElement>(null);
  const levelField = useRef<HTMLDivElement>(null);
  const type = types.find(t => t.id === typeId);
  const skill = isSkillType(type);
  const typeProblem = typeId ? null : 'Välj en kompetens.';
  const levelProblem = skill && level === null ? 'Välj en nivå.' : null;
  const issuedProblem = skill
    ? null
    : !issuedOn
      ? 'Välj dagen då intyget utfärdades.'
      : issuedOn > today()
        ? 'Dagen har inte kommit.'
        : null;
  const expiresProblem =
    !skill && expiresOn && issuedOn && expiresOn < issuedOn ? 'Slutdatumet kan inte vara före utfärdandet.' : null;
  const reset = () => {
    setTypeId(undefined);
    setIssuedOn(undefined);
    setExpiresOn(undefined);
    setLevel(null);
    setInterest(false);
    setTried(false);
  };
  const ready = (): ReadyHolding | null => {
    if (typeProblem || levelProblem || issuedProblem || expiresProblem || !type) {
      setTried(true);
      if (typeProblem) typeField.current?.focus();
      else if (levelProblem) focusChoice(levelField);
      else (issuedProblem ? issuedField : expiresField).current?.focus();
      return null;
    }
    if (skill && level !== null)
      return { kind: 'skill', body: { typeId: type.id, level, interest: mode !== 'manager' && interest }, type };
    if (!issuedOn) return null;
    return { kind: 'dated', body: { typeId: type.id, issuedOn, ...(expiresOn ? { expiresOn } : {}) }, type };
  };
  const status = (problem: string | null) =>
    tried && problem ? { status: { type: 'error' as const, message: problem } } : {};
  const notice = (
    <Text as="p" type="supporting" role="status">
      {NOTICE[mode][skill ? 'skill' : 'dated']}
    </Text>
  );
  const fields = (
    <FormLayout direction="vertical" defaultOptionality="required">
      <Selector
        ref={typeField}
        label="Kompetens"
        placeholder="Välj en kompetens"
        options={options(types)}
        value={typeId as never}
        onChange={value => setTypeId(value ?? undefined)}
        hasSearch={types.length > 8}
        searchPlaceholder="Sök kompetens"
        emptyText="Katalogen har inga kompetenser ännu."
        emptySearchText="Ingen kompetens matchar."
        presentation="adaptive"
        {...status(typeProblem)}
      />
      {skill ? (
        <>
          <LevelField groupRef={levelField} value={level} onChange={setLevel} problem={tried ? levelProblem : null} />
          {mode !== 'manager' && <InterestField value={interest} onChange={setInterest} />}
        </>
      ) : (
        <>
          <DateInput
            ref={issuedField}
            label="Utfärdat"
            value={issuedOn as never}
            onChange={value => setIssuedOn(value ?? undefined)}
            weekStartsOn="mon"
            placeholder="Välj ett datum"
            presentation="adaptive-bottom-sheet"
            {...status(issuedProblem)}
          />
          <DateInput
            ref={expiresField}
            label="Giltigt till"
            description={
              type?.validityMonths
                ? `Lämna tomt om intyget saknar slutdatum: då gäller det ${months(type.validityMonths)} från utfärdandet.`
                : 'Slutdatumet som står på intyget. Lämna tomt om det inte har något.'
            }
            value={expiresOn as never}
            onChange={value => setExpiresOn(value ?? undefined)}
            weekStartsOn="mon"
            placeholder="Välj ett datum"
            presentation="adaptive-bottom-sheet"
            isOptional
            {...status(expiresProblem)}
          />
        </>
      )}
    </FormLayout>
  );
  return { fields, notice, ready, reset, skill };
}

/**
 * Registering a holding for a person who reports to the manager (D108 item 7, D120 item 2). A dialog over the list,
 * with the person named in its heading and in the address (`?register=<personId>`, D83): closing it, by Avbryt, Esc or
 * the close button, is the list again with the focus on what opened it, which Astryx gives back. The way in is the page
 * the competence module declares on its read about a person (D97): "Registrera intyg" in the person's Kompetens section.
 * Its title names what is registered: a certificate with its dates, or a skill with its level, confirmed by the manager
 * who registers it.
 *
 * On the matrix (D108 item 11) a cell opens it for its person and its type (`?competence=<typeId>`), which the form
 * starts on and the person may change; closing it gives the focus to the cell's own control (`opener`), since the menu
 * row it was opened from is gone by then. On success the dialog closes, the marks and any open view are read again,
 * and a toast says it is registered.
 */
export function RegisterHolding({
  opener,
  people: given,
}: {
  /** The control on the page that opened the form for this person and type, which takes the focus when it closes. */
  opener?: (personId: string, typeId: string | null) => HTMLElement | null;
  /**
   * Whom the form may be opened for, where the page has read them already: the matrix's rows, the server's own answer of
   * who reports to the reader (D99). Absent, Personal's people are read, as Personal opens it.
   */
  people?: Array<{ id: string; name: string }> | undefined;
} = {}) {
  const mobile = useMediaQuery(mobileQuery);
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const personId = registerOf(search);
  const preset = registerTypeOf(search);
  // Read only when the address names someone: the people the reader manages, as the talk drawer reads them, and the
  // catalogue, which is refused (null) while the module is off for the reader.
  const staffQ = useQuery({ ...staffQuery, enabled: !!personId && !given });
  const typesQ = useQuery({ ...competenceTypesQuery, enabled: !!personId });
  const people = given ?? (staffQ.data?.units ?? []).flatMap(u => u.people).filter(p => p.enabled);
  const types = (typesQ.data?.rows ?? []).filter(t => !t.archived);
  // Nobody is named unless there is something to register: with the module off, or an empty catalogue, the address
  // opens nothing.
  const person = personId && types.length ? people.find(p => p.id === personId) : undefined;
  const action = useAdminAction({
    invalidate: [keys.entities.all, keys.viewAll, keys.competenceAll],
    toastId: 'competence:register',
  });
  const form = useHoldingFields(types, preset);
  const close = () => {
    form.reset();
    action.reset();
    navigate(withoutRegister(pathname, search));
  };
  const submit = async () => {
    if (action.busy || !person) return;
    const ready = form.ready();
    if (!ready) return;
    await action.run(async () => {
      if (ready.kind === 'skill') {
        await api.competence.registerSkill(person.id, { typeId: ready.body.typeId, level: ready.body.level });
        close();
        return `${ready.type.name} är registrerad för ${person.name} på nivån ${levelLabel(ready.body.level)}.`;
      }
      await api.competence.register(person.id, ready.body);
      close();
      return `Intyget är registrerat för ${person.name}.`;
    });
  };
  const onOpenChange = (open: boolean) => {
    if (!open) close();
  };
  // Astryx gives the focus back to what had it when the form opened. Opened from a menu's row, that is gone once the
  // form closes, so the page's own control for this person and type takes it (`opener`) once the dialog has closed.
  const openerRef = useRef(opener);
  openerRef.current = opener;
  const shown = useRef<{ personId: string; typeId: string | null } | null>(null);
  useEffect(() => {
    if (person) shown.current = { personId: person.id, typeId: preset };
  }, [person?.id, preset]);
  const [dialog, setDialog] = useState<HTMLDialogElement | null>(null);
  const frame = useCallback((el: HTMLDivElement | null) => setDialog(el?.closest('dialog') ?? null), []);
  useEffect(() => {
    if (!dialog) return;
    const closed = () => {
      const cell = shown.current;
      shown.current = null;
      if (cell && openerRef.current)
        requestAnimationFrame(() => openerRef.current?.(cell.personId, cell.typeId)?.focus());
    };
    dialog.addEventListener('close', closed);
    return () => dialog.removeEventListener('close', closed);
  }, [dialog]);
  return (
    <Dialog
      isOpen={!!person}
      onOpenChange={onOpenChange}
      width={480}
      purpose="form"
      variant={mobile ? 'fullscreen' : 'standard'}
    >
      <DialogFrame
        header={
          <DialogHeader
            title={form.skill ? 'Registrera färdighet' : 'Registrera intyg'}
            subtitle={person ? `För ${person.name}` : undefined}
            onOpenChange={onOpenChange}
          />
        }
        error={action.error}
        primary={
          <>
            <Button size="sm" variant="ghost" label="Avbryt" onClick={close} />
            <Button
              size="sm"
              variant="primary"
              label="Registrera"
              isLoading={action.busy}
              onClick={() => void submit()}
            />
          </>
        }
      >
        <VStack gap={3} ref={frame}>
          {form.notice}
          {form.fields}
        </VStack>
      </DialogFrame>
    </Dialog>
  );
}

/** What the server says to someone who reports to nobody (D108 item 7, open who approves then), said before it is sent. */
export const NO_APPROVER = 'Registreringen kan inte skickas: ingen chef är registrerad för dig.';

/**
 * A person adds a competence of their own (D108 item 7, D120 item 2), on Mina kompetenser in a dialog named in the
 * address (`?add=new`). A certificate asks what the manager's registration asks and is sent for the manager they report
 * to to approve, which the dialog says before it is sent. A skill asks the level and whether they want to develop it,
 * and is saved at once as their own rating, which the dialog says instead; the sentence is a status region, so the change
 * of kind is announced. A skill they hold already (`held`) is not offered: it is changed from its own row. Someone who
 * reports to nobody (`approver` false) is offered the skills alone, which need no approval, and the sentence says why
 * before one is chosen and what a skill is once it is; with no skill to add they are told, in the server's words, that a
 * certificate cannot be sent, and offered nothing to fill in. On success the dialog closes, the page's own lists are read
 * again and a toast says it was sent or saved; the page gives the focus back (`onClose`).
 */
export function AddOwnHolding({
  isOpen,
  approver,
  held = [],
  onClose,
}: {
  isOpen: boolean;
  /** Whether anyone would decide it; undefined until the server has answered, when the form is offered. */
  approver: boolean | undefined;
  /** The skills the person holds now, by type: not offered again, since one is changed, not added twice. */
  held?: readonly string[];
  onClose: () => void;
}) {
  const mobile = useMediaQuery(mobileQuery);
  const typesQ = useQuery({ ...competenceOwnTypesQuery, enabled: isOpen });
  const open = (typesQ.data?.rows ?? []).filter(t => !t.archived && !(isSkillType(t) && held.includes(t.id)));
  const noApprover = approver === false;
  // Without anyone to approve a certificate, the skills alone: they need no approval (D120 item 2).
  const types = noApprover ? open.filter(t => isSkillType(t)) : open;
  const action = useAdminAction({
    invalidate: [keys.competenceAll, keys.viewAll, keys.entities.all],
    toastId: 'competence:own',
  });
  const form = useHoldingFields(types, null, noApprover ? 'own-alone' : 'own');
  useEffect(() => {
    form.reset();
    action.reset();
    // Filled afresh each time it opens: a refetch while it is open must not undo what is being filled in.
  }, [isOpen]);
  const submit = async () => {
    if (action.busy) return;
    const ready = form.ready();
    if (!ready) return;
    await action.run(async () => {
      if (ready.kind === 'skill') {
        await api.competence.rateOwnSkill(ready.body);
        onClose();
        return `${ready.type.name} är sparad som din egen bedömning.`;
      }
      await api.competence.registerOwn(ready.body);
      onClose();
      return `${ready.type.name} är skickat till din chef för godkännande.`;
    });
  };
  const onOpenChange = (next: boolean) => {
    if (!next) onClose();
  };
  const blocked = noApprover && typesQ.isSuccess && types.length === 0;
  return (
    <Dialog
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      width={480}
      purpose="form"
      variant={mobile ? 'fullscreen' : 'standard'}
    >
      <DialogFrame
        header={
          <DialogHeader title={form.skill ? 'Lägg till färdighet' : 'Lägg till intyg'} onOpenChange={onOpenChange} />
        }
        error={action.error}
        primary={
          blocked ? (
            <Button size="sm" variant="secondary" label="Stäng" onClick={onClose} />
          ) : (
            <>
              <Button size="sm" variant="ghost" label="Avbryt" onClick={onClose} />
              <Button
                size="sm"
                variant="primary"
                label={form.skill ? 'Spara' : 'Skicka för godkännande'}
                isLoading={action.busy}
                onClick={() => void submit()}
              />
            </>
          )
        }
      >
        {blocked ? (
          <Text as="p">{NO_APPROVER} Den som administrerar Startsidan kan rätta det.</Text>
        ) : (
          <VStack gap={3}>
            {form.notice}
            {form.fields}
          </VStack>
        )}
      </DialogFrame>
    </Dialog>
  );
}

/**
 * A person changes a skill of their own (D120 items 2 and 3), on Mina kompetenser in a dialog named in the address
 * (`?skill=<holding id>`) and titled as the menu's row that opens it, "Ändra nivå": its level, chosen afresh among the
 * three, and whether they want to develop it. The skill
 * itself is shown and cannot be changed here. A new level is their own rating again until the manager they report to
 * confirms it, which the dialog says where a manager has confirmed the one it has; the interest mark alone changes
 * nothing else. On success the dialog closes, the page's lists are read again and a toast says it is saved; the page
 * gives the focus back (`onClose`).
 */
export function ChangeOwnSkill({ skill, onClose }: { skill: CompetenceOwnSkill | undefined; onClose: () => void }) {
  const mobile = useMediaQuery(mobileQuery);
  const action = useAdminAction({
    invalidate: [keys.competenceAll, keys.viewAll, keys.entities.all],
    toastId: 'competence:skill',
  });
  const [level, setLevel] = useState<CompetenceLevel | null>(null);
  const [interest, setInterest] = useState(false);
  useEffect(() => {
    setLevel(skill?.level ?? null);
    setInterest(skill?.interest ?? false);
    action.reset();
    // Filled from the skill each time it opens for another one: a refetch must not undo what is being chosen.
  }, [skill?.holdingId]);
  const submit = async () => {
    if (action.busy || !skill || level === null) return;
    await action.run(async () => {
      await api.competence.changeOwnSkill(skill.holdingId, { level, interest });
      onClose();
      return `${skill.competence} är sparad.`;
    });
  };
  const onOpenChange = (next: boolean) => {
    if (!next) onClose();
  };
  const relevelled = !!skill && level !== skill.level;
  return (
    <Dialog
      isOpen={!!skill}
      onOpenChange={onOpenChange}
      width={480}
      purpose="form"
      variant={mobile ? 'fullscreen' : 'standard'}
    >
      <DialogFrame
        header={<DialogHeader title="Ändra nivå" subtitle={skill?.competence} onOpenChange={onOpenChange} />}
        error={action.error}
        primary={
          <>
            <Button size="sm" variant="ghost" label="Avbryt" onClick={onClose} />
            <Button size="sm" variant="primary" label="Spara" isLoading={action.busy} onClick={() => void submit()} />
          </>
        }
      >
        <VStack gap={3}>
          <Text as="p" type="supporting" role="status">
            {skill?.validated && relevelled
              ? 'Din chef har bekräftat den nivå du har nu. En ny nivå är din egen bedömning tills din chef bekräftar den.'
              : skill?.validated
                ? 'Din chef har bekräftat nivån.'
                : 'Nivån är din egen bedömning tills din chef bekräftar den.'}
          </Text>
          <FormLayout direction="vertical" defaultOptionality="required">
            <LevelField value={level} onChange={setLevel} />
            <InterestField value={interest} onChange={setInterest} />
          </FormLayout>
        </VStack>
      </DialogFrame>
    </Dialog>
  );
}
