import { useEffect, useRef, useState } from 'react';
import type { CheckReport, ConnectorAudience, ConnectorDetail } from '@clew/contracts';
import { Banner, Button, Dialog, DialogHeader, FormLayout, Heading, LayoutHeader, List, ListItem, MetadataList, MetadataListItem, Spinner, StatusDot, Step, Stepper, Switch, Text, TextInput, VStack } from '@clew/ui';
import { api } from '../../api';
import { useAdminAction } from '../../mutations';
import { AudienceEditor } from './audience';
import { DialogFrame } from './dialog-frame';
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
  // Each step's call re-reads the admin lists on success (the draft row exists from the check on); the error is the dialog's own line.
  const { run, busy, error, reset: clearError } = useAdminAction();
  const [result, setResult] = useState<{ connector: ConnectorDetail; report: CheckReport } | null>(null);
  const [audience, setAudience] = useState<ConnectorAudience>({ mode: 'all' });
  const [scan, setScan] = useState(true); const [tools, setTools] = useState(true); const [menu, setMenu] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  // The step heading takes focus on every step (2.4.3): a screen reader hears where the flow is.
  useEffect(() => { if (isOpen) heading.current?.focus(); }, [step, isOpen]);
  const idError = touched && !ID.test(id) ? 'Små bokstäver, siffror och bindestreck; börjar med en bokstav.' : undefined;
  const urlError = touched && !/^https?:\/\/\S+$/.test(url) ? 'En adress som börjar med http:// eller https://.' : undefined;
  const secretError = touched && secret.length < 16 ? 'Minst 16 tecken.' : undefined;
  const valid = ID.test(id) && /^https?:\/\/\S+$/.test(url) && secret.length >= 16;
  const reset = () => { setStep(0); setId(''); setUrl(''); setSecret(''); setTouched(false); clearError(); setResult(null); setAudience({ mode: 'all' }); setScan(true); setTools(true); setMenu(false); };
  const close = (added: boolean) => { reset(); onClose(added); };
  const check = () => run(async () => { setResult(await api.admin.add({ id, url, secret })); setStep(1); });
  const retry = () => run(async () => { if (!result) return; const report = await api.admin.test(result.connector.id); const connector = await api.admin.connector(result.connector.id); setResult({ connector, report }); });
  const finish = (state: 'draft' | 'enabled') => run(async () => { if (!result) return; await api.admin.update(result.connector.id, { audience, scanEnabled: scan, toolsEnabled: tools, ...(result.connector.menu ? { menuEnabled: menu } : {}), ...(state === 'enabled' ? { state } : {}) }); close(true); });
  const fetched = !!result?.connector.counts.capabilities;
  // Astryx's form-wizard-dialog: the title and the stepper pinned, the step scrolling, the buttons pinned in the footer.
  const header = <>
    <DialogHeader title="Anslut system" subtitle={result ? 'Anslutningen är sparad som utkast tills du sätter på den.' : undefined} onOpenChange={open => { if (!open) close(!!result); }} hasDivider={false} />
    <LayoutHeader hasDivider={false}>
      <Stepper activeStep={step} label="Steg" density="compact" horizontalOptions={{ minimumStepWidth: 100, collapsedVariant: 'withLabel' }}>
        {steps.map((s, i) => <Step key={s} step={i} label={s} />)}
      </Stepper>
    </LayoutHeader>
  </>;
  return <Dialog isOpen={isOpen} onOpenChange={open => { if (!open) close(!!result); }} width={620} purpose="form">
    <DialogFrame header={header} error={error}
      secondary={step > 0 && <Button variant="ghost" label="Tillbaka" isDisabled={busy} onClick={() => setStep(step - 1)} />}
      primary={<>
        {step === 0 && <Button variant="primary" label="Kontrollera" isDisabled={busy || (touched && !valid)} clickAction={async () => { setTouched(true); if (valid) await check(); }} />}
        {step === 1 && <Button variant="primary" label="Nästa" isDisabled={busy || !result} onClick={() => setStep(2)} />}
        {step === 2 && <Button variant="primary" label="Nästa" onClick={() => setStep(3)} />}
        {step === 3 && <>
          <Button variant="secondary" label="Spara som utkast" isDisabled={busy} clickAction={() => finish('draft')} />
          <Button variant="primary" label="Sätt på" isDisabled={busy || !fetched} clickAction={() => finish('enabled')} />
        </>}
      </>}>
    <VStack gap={4}>
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
        {result?.connector.menu && <Switch label="Visa i menyn" description={`Raden ${result.connector.menu.label} läggs under Verktyg i menyn för alla som ser anslutningen.`} value={menu} onChange={setMenu} />}
      </VStack>}
      {step === 3 && result && <MetadataList>
        <MetadataListItem label="System">{result.connector.source}</MetadataListItem>
        <MetadataListItem label="Id">{result.connector.id}</MetadataListItem>
        <MetadataListItem label="Adress">{result.connector.url}</MetadataListItem>
        <MetadataListItem label="Förmågor">{`${result.connector.counts.capabilities} · ${result.connector.counts.execute} åtgärder`}</MetadataListItem>
        <MetadataListItem label="Vem ser det">{audienceLabel(audience)}</MetadataListItem>
        <MetadataListItem label="Skickar kort">{scan ? 'Ja' : 'Nej'}</MetadataListItem>
        <MetadataListItem label="Erbjuder assistenten">{tools ? 'Ja' : 'Nej'}</MetadataListItem>
        {result.connector.menu && <MetadataListItem label="Rad i menyn">{menu ? result.connector.menu.label : 'Nej'}</MetadataListItem>}
      </MetadataList>}
    </VStack>
    </DialogFrame>
  </Dialog>;
}
