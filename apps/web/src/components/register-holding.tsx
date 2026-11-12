import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { CompetenceHoldingBody, CompetenceType } from '@clew/contracts';
import { Button, DateInput, Dialog, DialogHeader, FormLayout, Selector, Text, VStack, useMediaQuery } from '@clew/ui';
import { today } from '@clew/calendar/dates';
import { api } from '../api';
import { useAdminAction } from '../mutations';
import { competenceOwnTypesQuery, competenceTypesQuery, staffQuery } from '../queries';
import { keys } from '../query-keys';
import { registerOf, registerTypeOf, withoutRegister } from '../register-address';
import { DialogFrame } from './dialog-frame';
import { mobileQuery } from './shell';

/**
 * Registering a holding (D108 item 7): by the manager a person reports to, for them (`RegisterHolding`), or by the person
 * for themselves, for that manager to approve (`AddOwnHolding`). Both ask the same: which competence, the day it was
 * issued and, where the issuer set one, the day it ends (`useHoldingFields`). The server computes where the holding
 * stands; the form only says what the certificate says.
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

/**
 * The fields a holding is registered with, and what is wrong with them: the competence from the catalogue grouped by
 * area (starting on `preset` while it can be registered), the day it was issued, and the day it ends. `ready` says
 * what is wrong on the fields and gives the first the focus, or answers the body to send; `reset` empties them.
 */
export function useHoldingFields(types: CompetenceType[], preset: string | null) {
  // The type the person chose; until they choose, the one the address starts on, while it can be registered.
  const [picked, setTypeId] = useState<string | undefined>(undefined);
  const typeId = picked ?? (preset && types.some(t => t.id === preset) ? preset : undefined);
  const [issuedOn, setIssuedOn] = useState<string | undefined>(undefined);
  const [expiresOn, setExpiresOn] = useState<string | undefined>(undefined);
  const [tried, setTried] = useState(false);
  const typeField = useRef<HTMLButtonElement>(null);
  const issuedField = useRef<HTMLInputElement>(null);
  const expiresField = useRef<HTMLInputElement>(null);
  const type = types.find(t => t.id === typeId);
  const typeProblem = typeId ? null : 'Välj en kompetens.';
  const issuedProblem = !issuedOn
    ? 'Välj dagen då intyget utfärdades.'
    : issuedOn > today()
      ? 'Dagen har inte kommit.'
      : null;
  const expiresProblem =
    expiresOn && issuedOn && expiresOn < issuedOn ? 'Slutdatumet kan inte vara före utfärdandet.' : null;
  const reset = () => {
    setTypeId(undefined);
    setIssuedOn(undefined);
    setExpiresOn(undefined);
    setTried(false);
  };
  const ready = (): { body: CompetenceHoldingBody; type: CompetenceType } | null => {
    if (typeProblem || issuedProblem || expiresProblem || !type || !issuedOn) {
      setTried(true);
      (typeProblem ? typeField : issuedProblem ? issuedField : expiresField).current?.focus();
      return null;
    }
    return { body: { typeId: type.id, issuedOn, ...(expiresOn ? { expiresOn } : {}) }, type };
  };
  const status = (problem: string | null) =>
    tried && problem ? { status: { type: 'error' as const, message: problem } } : {};
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
    </FormLayout>
  );
  return { fields, ready, reset };
}

/**
 * Registering a certificate for a person who reports to the manager (D108 item 7). A dialog over the list, with the
 * person named in its heading and in the address (`?register=<personId>`, D83): closing it, by Avbryt, Esc or the close
 * button, is the list again with the focus on what opened it, which Astryx gives back. The way in is the page the
 * competence module declares on its read about a person (D97): "Registrera intyg" in the person's Kompetens section.
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
            title="Registrera intyg"
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
          {form.fields}
        </VStack>
      </DialogFrame>
    </Dialog>
  );
}

/** What the server says to someone who reports to nobody (D108 item 7, open who approves then), said before it is sent. */
export const NO_APPROVER = 'Registreringen kan inte skickas: ingen chef är registrerad för dig.';

/**
 * A person registers a certificate of their own (D108 item 7), on Mina kompetenser in a dialog named in the address
 * (`?add=new`). It asks what the manager's registration asks, says before it is sent that the manager they report to
 * must approve it before it counts, and sends it for approval. Someone who reports to nobody (`approver` false) is told
 * it cannot be sent, in the server's words, and offered nothing to fill in. On success the dialog closes, the page's
 * own lists are read again and a toast says it was sent; the page gives the focus back (`onClose`).
 */
export function AddOwnHolding({
  isOpen,
  approver,
  onClose,
}: {
  isOpen: boolean;
  /** Whether anyone would decide it; undefined until the server has answered, when the form is offered. */
  approver: boolean | undefined;
  onClose: () => void;
}) {
  const mobile = useMediaQuery(mobileQuery);
  const typesQ = useQuery({ ...competenceOwnTypesQuery, enabled: isOpen });
  const types = (typesQ.data?.rows ?? []).filter(t => !t.archived);
  const action = useAdminAction({
    invalidate: [keys.competenceAll, keys.viewAll, keys.entities.all],
    toastId: 'competence:own',
  });
  const form = useHoldingFields(types, null);
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
      await api.competence.registerOwn(ready.body);
      onClose();
      return `${ready.type.name} är skickat till din chef för godkännande.`;
    });
  };
  const onOpenChange = (open: boolean) => {
    if (!open) onClose();
  };
  const blocked = approver === false;
  return (
    <Dialog
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      width={480}
      purpose="form"
      variant={mobile ? 'fullscreen' : 'standard'}
    >
      <DialogFrame
        header={<DialogHeader title="Lägg till intyg" onOpenChange={onOpenChange} />}
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
                label="Skicka för godkännande"
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
            <Text as="p" type="supporting">
              Din chef behöver godkänna intyget innan det räknas.
            </Text>
            {form.fields}
          </VStack>
        )}
      </DialogFrame>
    </Dialog>
  );
}
