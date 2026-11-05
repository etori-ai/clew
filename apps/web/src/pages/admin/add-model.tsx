import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ProviderSummary, ProviderTestReport } from '@clew/contracts';
import { Banner, Button, CheckboxList, CheckboxListItem, Dialog, DialogHeader, FormLayout, Heading, LayoutHeader, List, ListItem, Spinner, Step, Stepper, Switch, Text, TextInput, VStack } from '@clew/ui';
import { api } from '../../api';
import { adminQueries } from '../../queries';
import { useAdminAction } from '../../mutations';
import { LevelDot } from './check-result';
import { DialogFrame } from './dialog-frame';

/**
 * Adding models (D24). Both dialogs follow Astryx's `form-wizard-dialog` composition: a Layout that fills the dialog,
 * the title (and the stepper) pinned in its header, the step in LayoutContent, which scrolls against the dialog's
 * maxHeight, and the actions in LayoutFooter, which never scrolls away however long the endpoint's model list is.
 * "Lägg till leverantör" is two steps: the address and the key (the row is saved and the endpoint asked for its
 * models), then the models to add. "Lägg till modell" asks the endpoint for its list when it opens and offers the same
 * picker. A new model is off unless the administrator says otherwise, so nothing answers in the box by accident.
 */
const ID = /^[a-z][a-z0-9-]*$/;
const URL_PATTERN = /^https?:\/\/\S+$/;
const WIRE = /^\S+$/;
const slug = (text: string) => text.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^[^a-z]+|-+$/g, '').slice(0, 40);

/** The findings of a test, as a list with a dot and a word each (colour never alone). */
export function Findings({ report, label = 'Kontrollens resultat' }: { report: ProviderTestReport; label?: string }) {
  return <List density="compact" aria-label={label}>
    {report.findings.map((f, i) => <ListItem key={i} startContent={<LevelDot level={f.level} />} label={<Text>{f.text}</Text>} />)}
  </List>;
}

/** What the administrator picks under one provider: ids ticked from the endpoint's list, one typed by hand, and whether they go on at once. */
export interface ModelPick { chosen: string[]; typed: string; enable: boolean }
const NO_PICK: ModelPick = { chosen: [], typed: '', enable: false };
/** The ids the pick adds: the ticked ones, then the typed one when it is a valid id that is neither ticked nor added already. */
const pickedIds = (p: ModelPick, existing: string[]) => {
  const typed = p.typed.trim();
  return [...p.chosen, ...(typed && WIRE.test(typed) && !p.chosen.includes(typed) && !existing.includes(typed) ? [typed] : [])];
};
const addLabel = (n: number) => n === 0 ? 'Lägg till' : n === 1 ? 'Lägg till 1 modell' : `Lägg till ${n} modeller`;
const addedMessage = (n: number, enable: boolean) => n === 1
  ? `1 modell tillagd${enable ? ' och påslagen' : ', avstängd tills du slår på den'}.`
  : `${n} modeller tillagda${enable ? ' och påslagna' : ', avstängda tills du slår på dem'}.`;
/** Add the picked models, each its own call and audit row, switched on afterwards when asked. Returns the toast. */
async function addPicked(providerId: string, ids: string[], enable: boolean): Promise<string> {
  for (const model of ids) {
    const added = await api.admin.addModel({ providerId, model });
    if (enable) await api.admin.updateModel(added.id, { state: 'enabled' });
  }
  return addedMessage(ids.length, enable);
}

/**
 * The picker both dialogs share: the endpoint's models that are not added yet as a CheckboxList, a field for an id the
 * endpoint does not list (or the only way in when it lists none), and the switch that turns them on at once.
 */
export function ModelPicker({ listed, existing, value, onChange }: { listed: string[]; existing: string[]; value: ModelPick; onChange: (pick: ModelPick) => void }) {
  const fresh = listed.filter(id => !existing.includes(id));
  const typed = value.typed.trim();
  const typedError = !typed ? undefined : !WIRE.test(typed) ? 'Utan mellanslag, exakt som leverantören skriver det.' : existing.includes(typed) ? 'Modellen är redan tillagd.' : undefined;
  return <VStack gap={4}>
    {fresh.length > 0 && <CheckboxList label="Modeller att lägga till" density="compact" value={value.chosen} onChange={chosen => onChange({ ...value, chosen })}
      description={`Leverantören listar ${listed.length}${fresh.length < listed.length ? `, varav ${listed.length - fresh.length} redan är tillagda` : ''}. Bocka för dem som ska kunna svara i frågerutan.`}>
      {fresh.map(id => <CheckboxListItem key={id} value={id} label={id} />)}
    </CheckboxList>}
    {listed.length > 0 && fresh.length === 0 && <Text type="supporting">Alla modeller som leverantören listar är redan tillagda.</Text>}
    <FormLayout>
      <TextInput label={fresh.length ? 'Eller en modell som inte finns i listan' : 'Modellens id hos leverantören'} value={value.typed} onChange={t => onChange({ ...value, typed: t })}
        description="Exakt som leverantören skriver det, till exempel gpt-oss:120b." autoComplete="off" hasAutoCorrect={false} autoCapitalize="none" status={typedError ? { type: 'error', message: typedError } : undefined} />
    </FormLayout>
    <Switch label="Slå på dem direkt" description="Annars läggs de till avstängda, och du slår på dem i listan." value={value.enable} onChange={enable => onChange({ ...value, enable })} />
  </VStack>;
}

const steps = ['Adress och nyckel', 'Modeller'];
export function AddProviderDialog({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [step, setStep] = useState(0);
  const [title, setTitle] = useState(''); const [id, setId] = useState(''); const [idTouched, setIdTouched] = useState(false);
  const [url, setUrl] = useState(''); const [key, setKey] = useState(''); const [touched, setTouched] = useState(false);
  const [result, setResult] = useState<{ providerId: string; report: ProviderTestReport } | null>(null);
  const [pick, setPick] = useState<ModelPick>(NO_PICK);
  const { run, busy, error, reset: clearError } = useAdminAction({ toastId: 'provider:new' });
  const heading = useRef<HTMLHeadingElement>(null);
  // The step heading takes focus on every step (2.4.3), as in "Anslut system".
  useEffect(() => { if (isOpen) heading.current?.focus(); }, [step, isOpen]);
  const shownId = idTouched ? id : slug(title);
  const errors = touched ? {
    title: title.trim() ? undefined : 'Ge leverantören ett namn.',
    id: ID.test(shownId) ? undefined : 'Små bokstäver, siffror och bindestreck; börjar med en bokstav.',
    url: URL_PATTERN.test(url) ? undefined : 'En adress som börjar med http:// eller https://, till exempel https://modeller.kommunen.se/v1.',
  } : {};
  const valid = !!title.trim() && ID.test(shownId) && URL_PATTERN.test(url);
  const reset = () => { setStep(0); setTitle(''); setId(''); setIdTouched(false); setUrl(''); setKey(''); setTouched(false); setResult(null); setPick(NO_PICK); clearError(); };
  const close = () => { reset(); onClose(); };
  const save = () => run(async () => { const r = await api.admin.addProvider({ id: shownId, title: title.trim(), baseUrl: url.trim(), ...(key ? { apiKey: key } : {}) }); setKey(''); setResult({ providerId: r.provider.id, report: r.report }); setStep(1); });
  const ids = result ? pickedIds(pick, []) : [];
  const header = <>
    <DialogHeader title="Lägg till leverantör" subtitle={result ? 'Leverantören är sparad. Välj vilka modeller som ska läggas till.' : 'Adressen till en tjänst som följer OpenAI:s API, till exempel en egen server med en öppen modell.'} onOpenChange={open => { if (!open) close(); }} hasDivider={false} />
    <LayoutHeader hasDivider={false}>
      <Stepper activeStep={step} label="Steg" density="compact" horizontalOptions={{ minimumStepWidth: 160, collapsedVariant: 'withLabel' }}>
        {steps.map((s, i) => <Step key={s} step={i} label={s} />)}
      </Stepper>
    </LayoutHeader>
  </>;
  return <Dialog isOpen={isOpen} onOpenChange={open => { if (!open) close(); }} width={620} purpose="form">
    <DialogFrame header={header} error={error}
      secondary={step === 0 ? <Button variant="ghost" label="Avbryt" onClick={close} /> : <Button variant="ghost" label="Klar" onClick={close} />}
      primary={step === 0
        ? <Button variant="primary" label="Testa och spara" isDisabled={busy || (touched && !valid)} clickAction={async () => { setTouched(true); if (valid) await save(); }} />
        : result && <Button variant="primary" label={addLabel(ids.length)} isDisabled={busy || !ids.length} clickAction={() => run(async () => { const message = await addPicked(result.providerId, ids, pick.enable); close(); return message; })} />}>
      <VStack gap={4}>
        <Heading level={3} ref={heading} tabIndex={-1}>{steps[step]}</Heading>
        {step === 0 && <FormLayout>
          <TextInput label="Namn" value={title} onChange={setTitle} description="Så heter leverantören i listan, till exempel Kommunens egna modeller." isRequired autoComplete="off" status={errors.title ? { type: 'error', message: errors.title } : undefined} />
          <TextInput label="Id" value={shownId} onChange={v => { setIdTouched(true); setId(v); }} description="Startsidans namn på leverantören. Föreslås från namnet." isRequired autoComplete="off" hasAutoCorrect={false} autoCapitalize="none" status={errors.id ? { type: 'error', message: errors.id } : undefined} />
          <TextInput label="Adress" type="url" value={url} onChange={setUrl} description="Basadressen, oftast slutar den på /v1." placeholder="https://modeller.kommunen.se/v1" isRequired autoComplete="off" status={errors.url ? { type: 'error', message: errors.url } : undefined} />
          <TextInput label="Nyckel" type="password" value={key} onChange={setKey} description="Lämna tomt för en adress utan nyckel. Den sparas förseglad och visas aldrig igen." autoComplete="new-password" />
        </FormLayout>}
        {step === 1 && result && <>
          {!result.report.ok && <Banner status="warning" container="section" collapsible={false} title="Leverantören är sparad, men kontrollen hittade fel." description="Rätta adressen eller nyckeln på leverantörens sida och testa igen. Modeller kan läggas till ändå." />}
          <Findings report={result.report} />
          <ModelPicker listed={result.report.models} existing={[]} value={pick} onChange={setPick} />
        </>}
      </VStack>
    </DialogFrame>
  </Dialog>;
}

/**
 * "Lägg till modell" on a provider: the endpoint is asked for its list as the dialog opens (the same check as "Testa",
 * so the provider's health is fresh too), and the picker offers what is not added yet, or an id by hand.
 */
export function AddModelDialog({ provider, onClose }: { provider: Pick<ProviderSummary, 'id' | 'title'> | null; onClose: () => void }) {
  const [pick, setPick] = useState<ModelPick>(NO_PICK);
  const listing = useQuery({ ...adminQueries.listed(provider?.id ?? ''), enabled: !!provider });
  const existing = (useQuery(adminQueries.models).data?.models ?? []).filter(m => m.providerId === provider?.id).map(m => m.model);
  const { run, busy, error, reset } = useAdminAction({ toastId: 'model:new' });
  const close = () => { setPick(NO_PICK); reset(); onClose(); };
  const report = listing.data;
  const ids = pickedIds(pick, existing);
  // The frame and its DialogHeader are always rendered: the Dialog takes its name from a title present when it mounts.
  return <Dialog isOpen={!!provider} onOpenChange={open => { if (!open) close(); }} width={620} purpose="form">
    <DialogFrame error={error}
      header={<DialogHeader title="Lägg till modell" subtitle={provider ? `Hos ${provider.title}. Modellerna läggs till avstängda om du inte slår på dem direkt.` : undefined} onOpenChange={open => { if (!open) close(); }} hasDivider={false} />}
      secondary={<Button variant="ghost" label="Avbryt" onClick={close} />}
      primary={<Button variant="primary" label={addLabel(ids.length)} isDisabled={busy || !ids.length || !provider} clickAction={() => run(async () => { if (!provider) return; const message = await addPicked(provider.id, ids, pick.enable); close(); return message; })} />}>
      {provider && <VStack gap={4}>
        {listing.isPending && <Spinner label="Frågar leverantören vilka modeller den har …" />}
        {report && !report.ok && <Findings report={report} label="Leverantörens svar" />}
        {listing.isError && <Text type="supporting">Leverantören svarade inte på vilka modeller den har. Lägg till en med dess id.</Text>}
        {!listing.isPending && <ModelPicker listed={report?.models ?? []} existing={existing} value={pick} onChange={setPick} />}
      </VStack>}
    </DialogFrame>
  </Dialog>;
}
