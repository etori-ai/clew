import { useEffect, useRef, useState } from 'react';
import type { CheckReport, ConnectorAudience, ConnectorDetail } from '@clew/contracts';
import { Banner, Button, Dialog, DialogHeader, FormLayout, HStack, Heading, List, ListItem, MetadataList, MetadataListItem, Spinner, StatusDot, Step, Stepper, Switch, Text, TextInput, VStack } from '@clew/ui';
import { api, ApiError } from '../../api';
import { AudienceEditor } from './audience';
import { audienceLabel } from './labels';

/**
 * "Anslut system" (D23): four steps in one dialog. Address and key, then the conformance check (the draft row exists from
 * here on), then who sees it, then activate. The default is to keep the draft, so a connector is never live by accident.
 */
const ID = /^[a-z][a-z0-9-]*$/;
const steps = ['Adress och nyckel', 'Kontroll', 'Vem ser det', 'Aktivera'];
type Props = { isOpen: boolean; onClose: (added: boolean) => void; units: Array<{ id: string; label: string }> };
export function AddConnectorDialog({ isOpen, onClose, units }: Props) {
  const [step, setStep] = useState(0);
  const [id, setId] = useState(''); const [url, setUrl] = useState(''); const [secret, setSecret] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ connector: ConnectorDetail; report: CheckReport } | null>(null);
  const [audience, setAudience] = useState<ConnectorAudience>({ mode: 'all' });
  const [scan, setScan] = useState(true); const [tools, setTools] = useState(true);
  const heading = useRef<HTMLHeadingElement>(null);
  // The step heading takes focus on every step (2.4.3): a screen reader hears where the flow is.
  useEffect(() => { if (isOpen) heading.current?.focus(); }, [step, isOpen]);
  const idError = touched && !ID.test(id) ? 'Små bokstäver, siffror och bindestreck; börjar med en bokstav.' : undefined;
  const urlError = touched && !/^https?:\/\/\S+$/.test(url) ? 'En adress som börjar med http:// eller https://.' : undefined;
  const secretError = touched && secret.length < 16 ? 'Minst 16 tecken.' : undefined;
  const valid = ID.test(id) && /^https?:\/\/\S+$/.test(url) && secret.length >= 16;
  const reset = () => { setStep(0); setId(''); setUrl(''); setSecret(''); setTouched(false); setError(null); setResult(null); setAudience({ mode: 'all' }); setScan(true); setTools(true); };
  const close = (added: boolean) => { reset(); onClose(added); };
  const run = async (fn: () => Promise<void>) => { setBusy(true); setError(null); try { await fn(); } catch (e) { setError(e instanceof ApiError ? e.message : 'Något gick fel.'); } finally { setBusy(false); } };
  const check = () => run(async () => { setResult(await api.admin.add({ id, url, secret })); setStep(1); });
  const retry = () => run(async () => { if (!result) return; const report = await api.admin.test(result.connector.id); const connector = await api.admin.connector(result.connector.id); setResult({ connector, report }); });
  const finish = (state: 'draft' | 'enabled') => run(async () => { if (!result) return; await api.admin.update(result.connector.id, { audience, scanEnabled: scan, toolsEnabled: tools, ...(state === 'enabled' ? { state } : {}) }); close(true); });
  const fetched = !!result?.connector.counts.capabilities;
  return <Dialog isOpen={isOpen} onOpenChange={open => { if (!open) close(!!result); }} width={620} purpose="form" padding={4}>
    <VStack gap={4}>
      <DialogHeader title="Anslut system" subtitle={result ? 'Anslutningen är sparad som utkast tills du sätter på den.' : undefined} onOpenChange={open => { if (!open) close(!!result); }} />
      <Stepper activeStep={step} label="Steg" density="compact" horizontalOptions={{ minimumStepWidth: 100, collapsedVariant: 'withLabel' }}>
        {steps.map((s, i) => <Step key={s} step={i} label={s} />)}
      </Stepper>
      <Heading level={3} ref={heading} tabIndex={-1}>{steps[step]}</Heading>
      {step === 0 && <FormLayout>
        <TextInput label="Id" value={id} onChange={setId} description="Samma id som anslutningen själv anger i sitt manifest, till exempel heroma." isRequired autoComplete="off" hasAutoCorrect={false} autoCapitalize="none" status={idError ? { type: 'error', message: idError } : undefined} />
        <TextInput label="Adress" type="url" value={url} onChange={setUrl} description="Adressen Clew når tjänsten på, utan /clew." placeholder="https://heroma-anslutning.kommunen.se" isRequired autoComplete="off" status={urlError ? { type: 'error', message: urlError } : undefined} />
        <TextInput label="Delad nyckel" type="password" value={secret} onChange={setSecret} description="Minst 16 tecken. Samma nyckel som tjänsten startas med. Den sparas förseglad och visas aldrig igen." isRequired autoComplete="new-password" status={secretError ? { type: 'error', message: secretError } : undefined} />
      </FormLayout>}
      {step === 1 && <VStack gap={3}>
        {busy && <Spinner label="Kontrollerar anslutningen …" />}
        {!busy && result && <>
          {!result.report.ok && <Banner status={fetched ? 'error' : 'warning'} container="section" collapsible={false} title={fetched ? 'Kontrollen hittade fel.' : 'Tjänsten svarade inte.'}
            description={fetched ? 'Utkastet är sparat. Rätta tjänsten och kontrollera igen.' : 'Utkastet är sparat utan manifest. Starta tjänsten och kontrollera igen, eller sätt på senare.'}
            endContent={<Button size="sm" variant="secondary" label="Försök igen" clickAction={retry} />} />}
          <List density="compact" aria-label="Kontrollens resultat">
            {result.report.findings.map((f, i) => <ListItem key={i} startContent={<StatusDot variant={f.level === 'ok' ? 'success' : f.level === 'warn' ? 'warning' : 'error'} label={f.level === 'ok' ? 'Ok' : f.level === 'warn' ? 'Varning' : 'Fel'} />} label={<Text>{f.text}</Text>} />)}
          </List>
        </>}
      </VStack>}
      {step === 2 && <VStack gap={3}>
        <AudienceEditor value={audience} onChange={setAudience} units={units} />
        <Switch label="Skicka kort" description="Anslutningen får föreslå kort i strömmen (den nattliga genomgången och första besöket)." value={scan} onChange={setScan} />
        <Switch label="Erbjud assistenten" description="Frågor och förslag som anslutningen märkt som verktyg får användas av assistenten." value={tools} onChange={setTools} />
      </VStack>}
      {step === 3 && result && <MetadataList>
        <MetadataListItem label="System">{result.connector.source}</MetadataListItem>
        <MetadataListItem label="Id">{result.connector.id}</MetadataListItem>
        <MetadataListItem label="Adress">{result.connector.url}</MetadataListItem>
        <MetadataListItem label="Förmågor">{`${result.connector.counts.capabilities} · ${result.connector.counts.execute} åtgärder`}</MetadataListItem>
        <MetadataListItem label="Vem ser det">{audienceLabel(audience)}</MetadataListItem>
        <MetadataListItem label="Skickar kort">{scan ? 'Ja' : 'Nej'}</MetadataListItem>
        <MetadataListItem label="Erbjuder assistenten">{tools ? 'Ja' : 'Nej'}</MetadataListItem>
      </MetadataList>}
      {error && <Text as="p" role="alert" color="accent">{error}</Text>}
      <HStack justify="between" gap={2} wrap="wrap">
        <HStack gap={2}>
          {step > 0 && step < 3 && <Button variant="ghost" label="Tillbaka" isDisabled={busy} onClick={() => setStep(step - 1)} />}
          {step === 3 && <Button variant="ghost" label="Tillbaka" isDisabled={busy} onClick={() => setStep(2)} />}
        </HStack>
        <HStack gap={2}>
          {step === 0 && <Button variant="primary" label="Kontrollera" isDisabled={busy || (touched && !valid)} clickAction={async () => { setTouched(true); if (valid) await check(); }} />}
          {step === 1 && <Button variant="primary" label="Nästa" isDisabled={busy || !result} onClick={() => setStep(2)} />}
          {step === 2 && <Button variant="primary" label="Nästa" onClick={() => setStep(3)} />}
          {step === 3 && <>
            <Button variant="secondary" label="Spara som utkast" isDisabled={busy} clickAction={() => finish('draft')} />
            <Button variant="primary" label="Sätt på" isDisabled={busy || !fetched} clickAction={() => finish('enabled')} />
          </>}
        </HStack>
      </HStack>
    </VStack>
  </Dialog>;
}
