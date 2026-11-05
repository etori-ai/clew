import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import type { ProviderSummary, ProviderTestReport } from '@clew/contracts';
import { Banner, Button, CheckboxList, CheckboxListItem, Dialog, DialogHeader, FormLayout, HStack, Heading, List, ListItem, StatusDot, Step, Stepper, Switch, Text, TextInput, VStack } from '@clew/ui';
import { api } from '../../api';
import { keys } from '../../query-keys';
import { useAdminAction } from '../../mutations';

/**
 * Adding models (D24). "Lägg till leverantör" is two steps in one dialog: the address and the key (the row is saved and
 * the endpoint asked for its models), then the models to add from what it listed, or one by name when it lists none.
 * "Lägg till modell" adds one model by the id its endpoint uses. A new model is off unless the administrator says
 * otherwise, so nothing answers in the box by accident.
 */
const ID = /^[a-z][a-z0-9-]*$/;
const URL_PATTERN = /^https?:\/\/\S+$/;
const WIRE = /^\S+$/;
const slug = (text: string) => text.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^[^a-z]+|-+$/g, '').slice(0, 40);

/** The findings of a test, as a list with a dot and a word each (colour never alone). */
export function Findings({ report, label = 'Kontrollens resultat' }: { report: ProviderTestReport; label?: string }) {
  return <List density="compact" aria-label={label}>
    {report.findings.map((f, i) => <ListItem key={i} startContent={<StatusDot variant={f.level === 'ok' ? 'success' : f.level === 'warn' ? 'warning' : 'error'} label={f.level === 'ok' ? 'Ok' : f.level === 'warn' ? 'Varning' : 'Fel'} />} label={<Text>{f.text}</Text>} />)}
  </List>;
}
/** Add several models at once, each its own call and audit row; switched on afterwards when asked. Returns how many. */
async function addModels(providerId: string, ids: string[], enable: boolean): Promise<number> {
  for (const model of ids) {
    const added = await api.admin.addModel({ providerId, model });
    if (enable) await api.admin.updateModel(added.id, { state: 'enabled' });
  }
  return ids.length;
}
const added = (n: number, enable: boolean) => n === 1
  ? `1 modell tillagd${enable ? ' och påslagen' : ', avstängd tills du sätter på den'}.`
  : `${n} modeller tillagda${enable ? ' och påslagna' : ', avstängda tills du sätter på dem'}.`;
/** The ids an endpoint listed that are not added yet, to tick and add in one go. */
export function ListedModels({ providerId, listed, existing, onAdded }: { providerId: string; listed: string[]; existing: string[]; onAdded?: () => void }) {
  const fresh = listed.filter(id => !existing.includes(id));
  const [chosen, setChosen] = useState<string[]>([]);
  const [enable, setEnable] = useState(false);
  const { run, busy, error } = useAdminAction({ toastId: 'provider:' + providerId });
  if (!fresh.length) return <Text type="supporting">{listed.length ? 'Alla modeller som leverantören listar är redan tillagda.' : 'Leverantören listar inga modeller.'}</Text>;
  return <VStack gap={3}>
    <CheckboxList label="Modeller att lägga till" description={`Leverantören listar ${listed.length}. Bocka för dem som ska kunna svara i frågerutan.`} value={chosen} onChange={setChosen} density="compact">
      {fresh.map(id => <CheckboxListItem key={id} value={id} label={id} />)}
    </CheckboxList>
    <Switch label="Sätt på dem direkt" description="Annars läggs de till avstängda, och du sätter på dem i listan." value={enable} onChange={setEnable} />
    {error && <Text as="p" role="alert" color="accent">{error}</Text>}
    <HStack><Button variant="primary" label={chosen.length ? `Lägg till ${chosen.length} ${chosen.length === 1 ? 'modell' : 'modeller'}` : 'Lägg till valda'} isDisabled={busy || !chosen.length}
      clickAction={() => run(async () => { const n = await addModels(providerId, chosen, enable); setChosen([]); onAdded?.(); return added(n, enable); })} /></HStack>
  </VStack>;
}

const steps = ['Adress och nyckel', 'Modeller'];
export function AddProviderDialog({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [title, setTitle] = useState(''); const [id, setId] = useState(''); const [idTouched, setIdTouched] = useState(false);
  const [url, setUrl] = useState(''); const [key, setKey] = useState(''); const [touched, setTouched] = useState(false);
  const [result, setResult] = useState<{ providerId: string; report: ProviderTestReport } | null>(null);
  const [model, setModel] = useState('');
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
  const reset = () => { setStep(0); setTitle(''); setId(''); setIdTouched(false); setUrl(''); setKey(''); setTouched(false); setResult(null); setModel(''); clearError(); };
  const close = () => { reset(); onClose(); };
  const save = () => run(async () => { const r = await api.admin.addProvider({ id: shownId, title: title.trim(), baseUrl: url.trim(), ...(key ? { apiKey: key } : {}) }); setKey(''); setResult({ providerId: r.provider.id, report: r.report }); setStep(1); });
  const addByName = () => run(async () => { if (!result) return; const m = await api.admin.addModel({ providerId: result.providerId, model: model.trim() }); close(); navigate(`/admin/modeller/${m.id}`); return 'Modellen är tillagd och avstängd tills du sätter på den.'; });
  return <Dialog isOpen={isOpen} onOpenChange={open => { if (!open) close(); }} width={620} purpose="form" padding={4}>
    <VStack gap={4}>
      <DialogHeader title="Lägg till leverantör" subtitle={result ? 'Leverantören är sparad. Välj vilka modeller som ska läggas till.' : 'En adress som talar det OpenAI-kompatibla gränssnittet, till exempel en egen server med en öppen modell.'} onOpenChange={open => { if (!open) close(); }} />
      <Stepper activeStep={step} label="Steg" density="compact" horizontalOptions={{ minimumStepWidth: 160, collapsedVariant: 'withLabel' }}>
        {steps.map((s, i) => <Step key={s} step={i} label={s} />)}
      </Stepper>
      <Heading level={3} ref={heading} tabIndex={-1}>{steps[step]}</Heading>
      {step === 0 && <FormLayout>
        <TextInput label="Namn" value={title} onChange={setTitle} description="Så heter leverantören i listan, till exempel Kommunens egna modeller." isRequired autoComplete="off" status={errors.title ? { type: 'error', message: errors.title } : undefined} />
        <TextInput label="Id" value={shownId} onChange={v => { setIdTouched(true); setId(v); }} description="Clews namn på leverantören. Föreslås från namnet." isRequired autoComplete="off" hasAutoCorrect={false} autoCapitalize="none" status={errors.id ? { type: 'error', message: errors.id } : undefined} />
        <TextInput label="Adress" type="url" value={url} onChange={setUrl} description="Basadressen, oftast slutar den på /v1." placeholder="https://modeller.kommunen.se/v1" isRequired autoComplete="off" status={errors.url ? { type: 'error', message: errors.url } : undefined} />
        <TextInput label="Nyckel" type="password" value={key} onChange={setKey} description="Lämna tomt för en adress utan nyckel. Den sparas förseglad och visas aldrig igen." autoComplete="new-password" />
      </FormLayout>}
      {step === 1 && result && <VStack gap={3}>
        {!result.report.ok && <Banner status="warning" container="section" collapsible={false} title="Leverantören är sparad, men kontrollen hittade fel." description="Rätta adressen eller nyckeln på leverantörens sida och testa igen. Modeller kan läggas till ändå." />}
        <Findings report={result.report} />
        {result.report.models.length > 0
          ? <ListedModels providerId={result.providerId} listed={result.report.models} existing={[]} onAdded={close} />
          : <FormLayout>
            <TextInput label="Modellens id hos leverantören" value={model} onChange={setModel} description="Exakt som leverantören skriver det, till exempel gpt-oss:120b." autoComplete="off" hasAutoCorrect={false} autoCapitalize="none" />
          </FormLayout>}
      </VStack>}
      {error && <Text as="p" role="alert" color="accent">{error}</Text>}
      <HStack justify="end" gap={2} wrap="wrap">
        {step === 0 && <>
          <Button variant="ghost" label="Avbryt" onClick={close} />
          <Button variant="primary" label="Testa och spara" isDisabled={busy || (touched && !valid)} clickAction={async () => { setTouched(true); if (valid) await save(); }} />
        </>}
        {step === 1 && <>
          <Button variant="ghost" label="Klar" onClick={close} />
          {result && result.report.models.length === 0 && <Button variant="primary" label="Lägg till modellen" isDisabled={busy || !WIRE.test(model.trim())} clickAction={addByName} />}
        </>}
      </HStack>
    </VStack>
  </Dialog>;
}

/** "Lägg till modell" on a provider: one model by the id its endpoint uses, then its page to switch it on. */
export function AddModelDialog({ provider, onClose }: { provider: Pick<ProviderSummary, 'id' | 'title'> | null; onClose: () => void }) {
  const navigate = useNavigate();
  const [model, setModel] = useState(''); const [title, setTitle] = useState(''); const [description, setDescription] = useState(''); const [touched, setTouched] = useState(false);
  const { run, busy, error, reset } = useAdminAction({ invalidate: [keys.admin.all], toastId: 'model:new' });
  const close = () => { setModel(''); setTitle(''); setDescription(''); setTouched(false); reset(); onClose(); };
  const modelError = touched && !WIRE.test(model.trim()) ? 'Skriv modellens id utan mellanslag, exakt som leverantören skriver det.' : undefined;
  return <Dialog isOpen={!!provider} onOpenChange={open => { if (!open) close(); }} width={520} purpose="form" padding={4}>
    {provider && <VStack gap={4}>
      <DialogHeader title="Lägg till modell" subtitle={`Hos ${provider.title}. Modellen läggs till avstängd.`} onOpenChange={open => { if (!open) close(); }} />
      <FormLayout>
        <TextInput label="Modellens id hos leverantören" value={model} onChange={setModel} description="Till exempel gpt-oss:120b." isRequired autoComplete="off" hasAutoCorrect={false} autoCapitalize="none" status={modelError ? { type: 'error', message: modelError } : undefined} />
        <TextInput label="Namn i frågerutan" value={title} onChange={setTitle} description="Det personen ser när hen väljer modell, till exempel Snabb (lokal). Tomt blir modellens id." autoComplete="off" />
        <TextInput label="Beskrivning" value={description} onChange={setDescription} description="En rad om vad modellen är bra på." autoComplete="off" />
      </FormLayout>
      {error && <Text as="p" role="alert" color="accent">{error}</Text>}
      <HStack justify="end" gap={2}>
        <Button variant="ghost" label="Avbryt" onClick={close} />
        <Button variant="primary" label="Lägg till" isDisabled={busy} clickAction={async () => {
          setTouched(true);
          if (!WIRE.test(model.trim())) return;
          await run(async () => { const m = await api.admin.addModel({ providerId: provider.id, model: model.trim(), ...(title.trim() ? { title: title.trim() } : {}), ...(description.trim() ? { description: description.trim() } : {}) }); close(); navigate(`/admin/modeller/${m.id}`); return 'Modellen är tillagd och avstängd tills du sätter på den.'; });
        }} />
      </HStack>
    </VStack>}
  </Dialog>;
}
