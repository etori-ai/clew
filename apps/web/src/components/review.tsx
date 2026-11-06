import { useEffect, useRef, useState } from 'react';
import type { Thread, ThreadAction, ThreadItem } from '@clew/contracts';
import {
  Badge,
  Button,
  Card,
  Dialog,
  DialogHeader,
  Grid,
  Heading,
  HStack,
  Icon,
  Layout,
  LayoutContent,
  LayoutFooter,
  Lightbox,
  List,
  ListItem,
  Skeleton,
  Step,
  Stepper,
  Text,
  VStack,
} from '@clew/ui';
import { useQuery } from '@tanstack/react-query';
import { previewQuery } from '../queries';
import { errorMessage } from '../query-policy';

type Decision = 'approve' | 'leave';
const decisionWord: Record<Decision, string> = { approve: 'Godkänd', leave: 'Lämnas kvar' };
/** The verb of the action, for its buttons: "Attestera valda" is "Attestera" on one row. */
const verbOf = (action: ThreadAction) => action.label.replace(/\s+valda$/i, '');
/** A row's short name for the stepper: what stands before the first " · " of its label. */
const shortLabel = (item: ThreadItem) => item.label.split(' · ')[0] ?? item.label;

/**
 * The review one row at a time (D70, artboards B and C): Astryx's fullscreen Dialog over the page, a Stepper with one step
 * per row and a last step Skicka, the row's document from the connector beside its facts, and for each row the action's
 * verb, Lämna kvar and Hoppa över. Nothing is written until the last step's one button, which runs the same execute with
 * the approved refs; Spara och stäng and Esc keep the decisions as the card's selection. No text input (D12): a question
 * about a row is asked in the conversation afterwards.
 */
export function ReviewDialog({
  thread,
  action,
  isOpen,
  onOpenChange,
  onSave,
  onSend,
}: {
  thread: Thread;
  action: ThreadAction;
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  /** The approved refs as the card's selection, on Spara och stäng and Esc. */
  onSave: (refs: string[]) => void;
  /** The approved refs, once, from the last step. */
  onSend: (refs: string[]) => void;
}) {
  const items = thread.items.filter(i => i.selectable);
  const [step, setStep] = useState(0);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [zoom, setZoom] = useState(false);
  useEffect(() => {
    if (isOpen) {
      setStep(0);
      setDecisions({});
    }
  }, [isOpen]);
  const item = items[step];
  const last = step >= items.length;
  const approved = items.filter(i => decisions[i.ref] === 'approve').map(i => i.ref);
  const left = items.filter(i => decisions[i.ref] === 'leave').length;
  const undecided = items.filter(i => !decisions[i.ref]).length;
  const verb = verbOf(action);
  const source = thread.trigger.source.toLowerCase();
  const close = () => {
    onSave(approved);
    onOpenChange(false);
  };
  const decide = (d: Decision) => {
    if (!item) return;
    setDecisions(prev => ({ ...prev, [item.ref]: d }));
    setStep(s => s + 1);
  };
  // Each step opens on its one next step, so Enter takes it (artboard B); the last step on its button, or its heading when there is nothing to send.
  const primary = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (!isOpen) return;
    const frame = requestAnimationFrame(() => (primary.current ?? heading.current)?.focus());
    return () => cancelAnimationFrame(frame);
  }, [isOpen, step]);
  const preview = useQuery({ ...previewQuery(thread.id, item?.ref ?? ''), enabled: isOpen && !!item });
  const dataUrl = preview.data ? `data:${preview.data.mediaType};base64,${preview.data.data}` : null;
  const isImage = !!preview.data && preview.data.mediaType !== 'application/pdf';
  // A decided row carries its mark; a row not yet looked at has none, and its description says so.
  const decisionIcon = (ref: string) =>
    decisions[ref] === 'approve' ? (
      <Icon icon="check" color="success" label="Godkänd" />
    ) : decisions[ref] === 'leave' ? (
      <Icon icon="clock" color="secondary" label="Lämnas kvar" />
    ) : undefined;
  const soFar = (
    <Card padding={3}>
      <List density="compact" hasDividers aria-label="Hittills">
        {items.map((i, n) => (
          <ListItem
            key={i.ref}
            startContent={decisionIcon(i.ref)}
            label={<Text weight={n === step ? 'semibold' : undefined}>{i.label}</Text>}
            description={n === step ? 'Det här' : decisions[i.ref] ? decisionWord[decisions[i.ref]!] : 'Inte bedömd än'}
            endContent={
              n !== step ? <Button size="sm" variant="ghost" label="Ändra" onClick={() => setStep(n)} /> : undefined
            }
          />
        ))}
      </List>
    </Card>
  );
  const document = item && (
    <VStack gap={2} as="section" aria-label="Underlaget">
      <HStack justify="between" vAlign="center" gap={2} wrap="wrap">
        <Text type="supporting" weight="semibold">
          Underlag från {source}
        </Text>
        {dataUrl && isImage && <Button size="sm" variant="ghost" label="Förstora" onClick={() => setZoom(true)} />}
      </HStack>
      <Card padding={2}>
        {preview.isPending ? (
          <Skeleton height={480} />
        ) : preview.isError ? (
          <VStack gap={2}>
            <Text as="p" role="alert">
              {errorMessage(preview.error, 'Underlaget kunde inte hämtas.')}
            </Text>
            <Button size="sm" variant="secondary" label="Försök igen" onClick={() => void preview.refetch()} />
          </VStack>
        ) : dataUrl && isImage ? (
          // A native image is the one thing here Astryx has no component for: it is sized to its column and nothing more.
          <img src={dataUrl} alt={preview.data!.title} style={{ display: 'block', width: '100%', height: 'auto' }} />
        ) : dataUrl ? (
          <VStack gap={2}>
            <Text>{preview.data!.title}</Text>
            <Button size="sm" variant="secondary" label="Hämta underlaget (PDF)" href={dataUrl} />
          </VStack>
        ) : null}
      </Card>
      {dataUrl && isImage && (
        <Lightbox isOpen={zoom} onOpenChange={setZoom} media={{ src: dataUrl, alt: preview.data!.title }} hasZoom />
      )}
    </VStack>
  );
  const decision = item && (
    <VStack gap={3}>
      <HStack gap={2} vAlign="center" wrap="wrap">
        <Badge variant="neutral" label={`${step + 1} av ${items.length}`} />
        {decisions[item.ref] && (
          <Badge
            variant={decisions[item.ref] === 'approve' ? 'success' : 'neutral'}
            label={decisionWord[decisions[item.ref]!]}
          />
        )}
      </HStack>
      <Heading ref={heading} tabIndex={-1} level={2} accessibilityLevel={2}>
        {item.label}
      </Heading>
      <Text as="p" color="secondary">
        {item.detail}
      </Text>
      <HStack gap={2} wrap="wrap">
        <Button ref={primary} size="lg" variant="primary" label={verb} onClick={() => decide('approve')} />
        <Button size="lg" variant="secondary" label="Lämna kvar" onClick={() => decide('leave')} />
        <Button size="lg" variant="ghost" label="Hoppa över" onClick={() => setStep(s => s + 1)} />
      </HStack>
      <Text type="supporting" as="p">
        Beslutet sparas som markering på kortet. Inget skrivs till {source} förrän du skickar i sista steget.
      </Text>
      {soFar}
    </VStack>
  );
  const summary = last && (
    <VStack gap={4}>
      <VStack gap={1}>
        <Heading ref={heading} tabIndex={-1} level={2} accessibilityLevel={2}>
          Det du valt
        </Heading>
        <Text as="p" color="secondary">
          {approved.length} av {items.length} skickas{left ? `, ${left} lämnas kvar` : ''}
          {undecided ? `, ${undecided} ${undecided === 1 ? 'är inte bedömd' : 'är inte bedömda'}` : ''}. Inget är
          skrivet än.
        </Text>
      </VStack>
      {soFar}
      <Card padding={3} variant="muted">
        <VStack gap={1.5}>
          <Text weight="semibold">Vad som händer när du skickar</Text>
          <Text as="p" type="supporting">
            {verb} skrivs till {source} i ett beslut och läses tillbaka rad för rad som kvitto. Grönt bara när {source}{' '}
            har bekräftat. Ångra i 10 minuter. Kortet går till Klart
            {left + undecided > 0
              ? `; det som lämnas kvar ligger kvar på kortet och kommer som ett eget kort vid nästa genomgång.`
              : '.'}
          </Text>
        </VStack>
      </Card>
      <HStack gap={2} wrap="wrap" vAlign="center">
        <Button
          ref={approved.length ? primary : undefined}
          size="lg"
          variant="primary"
          label={`${verb} ${approved.length}`}
          isDisabled={approved.length === 0}
          onClick={() => onSend(approved)}
        />
        <Button size="lg" variant="secondary" label="Spara och stäng" onClick={close} />
      </HStack>
    </VStack>
  );
  return (
    <Dialog
      isOpen={isOpen}
      onOpenChange={open => (open ? onOpenChange(true) : close())}
      variant="fullscreen"
      purpose="form"
    >
      <Layout
        header={
          <DialogHeader
            title={`Granska ${items.length} rader`}
            subtitle={`${thread.title} · inget skrivs förrän du skickar`}
            onOpenChange={open => (open ? onOpenChange(true) : close())}
            endContent={<Button size="sm" variant="ghost" label="Spara och stäng" onClick={close} />}
          />
        }
        content={
          <LayoutContent>
            <VStack gap={5}>
              {/* The steps show the way; Ändra in the list under each row is how one goes back, so a step is never a button whose name differs from its text (2.5.3). */}
              <Stepper
                activeStep={step}
                label="Rader"
                horizontalOptions={{ minimumStepWidth: 112, collapsedVariant: 'withLabel' }}
              >
                {items.map((i, n) => (
                  <Step
                    key={i.ref}
                    step={n}
                    label={shortLabel(i)}
                    description={decisions[i.ref] ? decisionWord[decisions[i.ref]!] : undefined}
                  />
                ))}
                <Step step={items.length} label="Skicka" />
              </Stepper>
              {item ? (
                <Grid columns={{ minWidth: 360, max: 2 }} gap={5}>
                  {document}
                  {decision}
                </Grid>
              ) : (
                summary
              )}
            </VStack>
          </LayoutContent>
        }
        footer={
          <LayoutFooter>
            <HStack justify="between" vAlign="center" gap={2} wrap="wrap">
              <Text type="supporting">Esc sparar och stänger. Inget skrivs till {source} förrän du skickar.</Text>
              <HStack gap={2}>
                <Button
                  size="sm"
                  variant="secondary"
                  label="Föregående"
                  isDisabled={step === 0}
                  onClick={() => setStep(s => s - 1)}
                />
                <Button
                  size="sm"
                  variant="secondary"
                  label="Nästa"
                  isDisabled={last}
                  onClick={() => setStep(s => s + 1)}
                />
              </HStack>
            </HStack>
          </LayoutFooter>
        }
      />
    </Dialog>
  );
}
