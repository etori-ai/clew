import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { CompetenceType } from '@clew/contracts';
import { Button, DateInput, Dialog, DialogHeader, FormLayout, Selector, VStack, useMediaQuery } from '@clew/ui';
import { today } from '@clew/calendar/dates';
import { api } from '../api';
import { useAdminAction } from '../mutations';
import { competenceTypesQuery, staffQuery } from '../queries';
import { keys } from '../query-keys';
import { registerOf, registerTypeOf, withoutRegister } from '../register-address';
import { DialogFrame } from './dialog-frame';
import { mobileQuery } from './shell';

/**
 * Registering a certificate for a person who reports to the manager (D108 item 7): which competence, the day it was
 * issued and, where the issuer set one, the day it ends. A dialog over the list, with the person named in its heading
 * and in the address (`?register=<personId>`, D83): closing it, by Avbryt, Esc or the close button, is the list again
 * with the focus on what opened it, which Astryx gives back. The way in is the page the competence module declares on
 * its read about a person (D97): "Registrera intyg" in the person's Kompetens section. The server computes where the holding stands; the form
 * only says what the certificate says.
 *
 * On the matrix (D108 item 11) a cell opens it for its person and its type (`?competence=<typeId>`), which the form
 * starts on and the person may change; closing it gives the focus to the cell's own control (`opener`), since the menu
 * row it was opened from is gone by then.
 *
 * The date fields take any day: a field that refused a day would drop what was typed without a word, and the form
 * would then register a certificate without the end date the person meant. A day that has not come, or an end before
 * the issue, is said on its field instead.
 *
 * What is missing is said on the field when Registrera is pressed, and the focus goes to the first such field. The
 * server's sentence is an alert beside the buttons and what was chosen stays. On success the dialog closes, the marks
 * and any open view are read again, and a toast says it is registered.
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
  const close = () => {
    setTypeId(undefined);
    setIssuedOn(undefined);
    setExpiresOn(undefined);
    setTried(false);
    action.reset();
    navigate(withoutRegister(pathname, search));
  };
  const submit = async () => {
    if (action.busy || !person) return;
    if (typeProblem || issuedProblem || expiresProblem) {
      setTried(true);
      (typeProblem ? typeField : issuedProblem ? issuedField : expiresField).current?.focus();
      return;
    }
    await action.run(async () => {
      await api.competence.register(person.id, {
        typeId: typeId!,
        issuedOn: issuedOn!,
        ...(expiresOn ? { expiresOn } : {}),
      });
      close();
      return `Intyget är registrerat för ${person.name}.`;
    });
  };
  const status = (problem: string | null) =>
    tried && problem ? { status: { type: 'error' as const, message: problem } } : {};
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
        </VStack>
      </DialogFrame>
    </Dialog>
  );
}
