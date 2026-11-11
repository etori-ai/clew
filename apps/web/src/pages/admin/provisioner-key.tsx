import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  PROVISIONER_GRACE_HOURS,
  PROVISIONER_ID_PATTERN,
  PROVISIONER_LABEL_MAX,
  type ProvisionerAdminRow,
  type ProvisionerKeyIssued,
} from '@clew/contracts';
import {
  AlertDialog,
  Banner,
  Button,
  CodeBlock,
  Dialog,
  DialogHeader,
  FormLayout,
  Heading,
  RadioList,
  RadioListItem,
  Text,
  TextInput,
  VStack,
  useToast,
} from '@clew/ui';
import { api } from '../../api';
import { keys } from '../../query-keys';
import { useAdminAction } from '../../mutations';
import { errorMessage } from '../../query-policy';
import { DialogFrame } from '../../components/dialog-frame';
import { slug } from './add-model';
import { instantText } from './labels';

/**
 * The keys of the catalogues that push people into Clew (D107), on Administration › Användare: a catalogue is added
 * and handed its key, the key is replaced, or it is taken back. Clew makes the key and keeps only its digest, so each
 * dialog that makes one shows it once, in a CodeBlock whose own button copies it, and says that it cannot be shown
 * again. A key never stops answering by itself: the time chosen when one is replaced is for the old key alone, and
 * the dialogs say so, since the product owner first read that choice as the new key's date of expiry. The two dialogs
 * that make a key are one (`KeyDialog`) with different first steps, and taking a key back is a confirmation.
 */
const ID = new RegExp(PROVISIONER_ID_PATTERN);
type Grace = (typeof PROVISIONER_GRACE_HOURS)[number];
/** How long the key that is replaced goes on answering. Only that: a key never stops answering by itself. */
const graceLabel: Record<Grace, string> = {
  24: 'Ett dygn till',
  168: 'En vecka till',
  0: 'Den slutar gälla direkt',
};
const rowOf = (issued: ProvisionerKeyIssued) => issued.overview.provisioners.find(p => p.id === issued.id);
/** Until when the key that was replaced still answers, as the row and the dialog say it. */
export const previousKeyUntil = (iso: string) => `Den förra nyckeln gäller till ${instantText(iso)}`;
/** The key, the one time it exists outside the catalogue: to copy, with where it is sent and that it will not be shown again. */
function KeyShown({ issued, note }: { issued: ProvisionerKeyIssued; note?: ReactNode }) {
  return (
    <VStack gap={4}>
      <Banner
        status="warning"
        container="section"
        collapsible={false}
        title="Nyckeln visas bara nu."
        description="Clew sparar bara ett avtryck av nyckeln och kan inte visa den igen. Kopiera den och lämna den på ett säkert sätt till den som sköter katalogen, inte i e-post eller chatt. Om den kommer bort byter du nyckel."
      />
      <CodeBlock code={issued.token} title={`Nyckel för ${rowOf(issued)?.label ?? issued.id}`} isWrapped width="100%" />
      <Text as="p">
        Katalogen skickar nyckeln i varje anrop till <Text type="code">{issued.address}</Text>, i huvudet{' '}
        <Text type="code">Authorization</Text> som <Text type="code">Bearer</Text> följt av nyckeln.
      </Text>
      <Text as="p">Nyckeln går inte ut av sig själv. Den gäller tills du byter eller återkallar den.</Text>
      {note && <Text as="p">{note}</Text>}
    </VStack>
  );
}

/**
 * A dialog that makes a key: a first step that asks, and a second that shows the key once. While the key is being
 * made, and while it is shown, the dialog is closed by its one button and nothing else: Escape and the header's close
 * button would discard the only copy of a key, or let an answer arrive at a dialog that is gone. The heading of what
 * is shown takes focus when the dialog opens and when the key replaces the first step (2.4.3). The frame and its
 * DialogHeader are always rendered: the Dialog takes its name from a title present when it mounts.
 */
function KeyDialog({
  isOpen,
  title,
  subtitle,
  heading,
  submitLabel,
  isSubmitDisabled = false,
  submit,
  onClose,
  note,
  children,
}: {
  isOpen: boolean;
  title: string;
  subtitle: (made: boolean) => string;
  heading: (made: boolean) => string;
  submitLabel: string;
  isSubmitDisabled?: boolean;
  /** Makes the key, or answers nothing when the first step is not ready to be sent. */
  submit: () => Promise<ProvisionerKeyIssued | undefined>;
  onClose: () => void;
  /** What to say under the key about the catalogue as it is now. */
  note?: (row: ProvisionerAdminRow | undefined) => ReactNode;
  /** The first step. */
  children: ReactNode;
}) {
  const client = useQueryClient();
  const [issued, setIssued] = useState<ProvisionerKeyIssued | null>(null);
  const { run, busy, error, reset } = useAdminAction({ invalidate: [keys.admin.users] });
  const top = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (isOpen) top.current?.focus();
  }, [issued, isOpen]);
  const held = busy || issued !== null;
  // The key leaves the page's memory with the dialog.
  const close = () => {
    setIssued(null);
    reset();
    onClose();
  };
  const dismiss = (open: boolean) => {
    if (!open && !held) close();
  };
  return (
    <Dialog isOpen={isOpen} onOpenChange={dismiss} width={620} purpose={held ? 'required' : 'form'}>
      <DialogFrame
        header={
          <DialogHeader
            title={title}
            subtitle={subtitle(issued !== null)}
            {...(held ? {} : { onOpenChange: dismiss })}
          />
        }
        error={error}
        secondary={issued ? undefined : <Button variant="ghost" label="Avbryt" isDisabled={busy} onClick={close} />}
        primary={
          issued ? (
            <Button variant="primary" label="Jag har sparat nyckeln" onClick={close} />
          ) : (
            <Button
              variant="primary"
              label={submitLabel}
              isDisabled={busy || isSubmitDisabled}
              clickAction={() =>
                run(async () => {
                  const result = await submit();
                  if (!result) return;
                  client.setQueryData(keys.admin.users, result.overview);
                  setIssued(result);
                })
              }
            />
          )
        }
      >
        <VStack gap={4}>
          <Heading level={3} ref={top} tabIndex={-1}>
            {heading(issued !== null)}
          </Heading>
          {issued ? <KeyShown issued={issued} note={note?.(rowOf(issued))} /> : children}
        </VStack>
      </DialogFrame>
    </Dialog>
  );
}

export function IssueProvisionerDialog({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [label, setLabel] = useState('');
  const [id, setId] = useState('');
  const [idTouched, setIdTouched] = useState(false);
  const [touched, setTouched] = useState(false);
  const shownId = idTouched ? id : slug(label);
  const errors = touched
    ? {
        label: label.trim() ? undefined : 'Ge katalogen ett namn.',
        id: ID.test(shownId) ? undefined : 'Två till 64 tecken: små bokstäver, siffror och bindestreck.',
      }
    : {};
  const valid = !!label.trim() && ID.test(shownId);
  return (
    <KeyDialog
      isOpen={isOpen}
      title="Lägg till katalog"
      subtitle={made =>
        made
          ? 'Katalogen är tillagd. Det här är nyckeln den anropar Clew med.'
          : 'En katalog är systemet som för in personer och enheter i Clew. Den får en nyckel att anropa Clew med.'
      }
      heading={made => (made ? 'Nyckeln' : 'Katalogen')}
      submitLabel="Skapa nyckel"
      isSubmitDisabled={touched && !valid}
      submit={async () => {
        setTouched(true);
        return valid ? api.admin.issueProvisioner({ id: shownId, label: label.trim() }) : undefined;
      }}
      onClose={() => {
        setLabel('');
        setId('');
        setIdTouched(false);
        setTouched(false);
        onClose();
      }}
    >
      <FormLayout>
        <TextInput
          label="Namn"
          value={label}
          onChange={value => setLabel(value.slice(0, PROVISIONER_LABEL_MAX))}
          description="Så heter katalogen på den här sidan, till exempel Metakatalogen."
          isRequired
          autoComplete="off"
          status={errors.label ? { type: 'error', message: errors.label } : undefined}
        />
        <TextInput
          label="Id"
          value={shownId}
          onChange={value => {
            setIdTouched(true);
            setId(value);
          }}
          description="Clews namn på katalogen i loggen över ändringar. Föreslås från namnet och kan inte ändras efteråt."
          isRequired
          autoComplete="off"
          hasAutoCorrect={false}
          autoCapitalize="none"
          status={errors.id ? { type: 'error', message: errors.id } : undefined}
        />
      </FormLayout>
    </KeyDialog>
  );
}

/** The catalogue a dialog is about, kept while the dialog closes so its words do not empty on the way out. */
function useShown(provisioner: ProvisionerAdminRow | null) {
  const [shown, setShown] = useState(provisioner);
  if (provisioner && provisioner !== shown) setShown(provisioner);
  return shown;
}

export function RotateProvisionerDialog({
  provisioner,
  onClose,
}: {
  provisioner: ProvisionerAdminRow | null;
  onClose: () => void;
}) {
  const shown = useShown(provisioner);
  const [grace, setGrace] = useState<Grace>(PROVISIONER_GRACE_HOURS[0]);
  const name = shown?.label ?? 'Katalogen';
  return (
    <KeyDialog
      isOpen={provisioner !== null}
      title="Byt nyckel"
      subtitle={made => (made ? `${name} har en ny nyckel.` : `${name} får en ny nyckel, som gäller tills vidare.`)}
      heading={made => (made ? 'Den nya nyckeln' : 'Den gamla nyckeln')}
      submitLabel="Byt nyckel"
      submit={async () =>
        provisioner ? api.admin.rotateProvisioner(provisioner.id, { graceHours: grace }) : undefined
      }
      onClose={() => {
        setGrace(PROVISIONER_GRACE_HOURS[0]);
        onClose();
      }}
      note={row =>
        row?.previousValidUntil
          ? `${previousKeyUntil(row.previousValidUntil)}. Byt den i katalogen före dess.`
          : 'Den förra nyckeln har slutat gälla. Inläsningen står stilla tills katalogen har fått den nya.'
      }
    >
      <RadioList
        label="Hur länge ska den gamla nyckeln fortsätta gälla?"
        description="Den nya nyckeln gäller tills vidare och går inte ut av sig själv. Valet gäller bara den gamla: med en tid kvar hinner den bytas i katalogen utan att en inläsning misslyckas. Låt den sluta gälla direkt om den kan ha hamnat i fel händer."
        value={String(grace)}
        onChange={value => setGrace(Number(value) as Grace)}
      >
        {PROVISIONER_GRACE_HOURS.map(hours => (
          <RadioListItem key={hours} value={String(hours)} label={graceLabel[hours]} />
        ))}
      </RadioList>
    </KeyDialog>
  );
}

export function RevokeProvisionerDialog({
  provisioner,
  onClose,
  onDone,
}: {
  provisioner: ProvisionerAdminRow | null;
  onClose: () => void;
  /**
   * After an attempt, whatever came of it: the catalogue may have left the list with its row and menu, so the page
   * says where the focus goes.
   */
  onDone: () => void;
}) {
  const client = useQueryClient();
  const toast = useToast();
  const shown = useShown(provisioner);
  const { run, busy } = useAdminAction({ invalidate: [keys.admin.users], toastId: 'provisioner:revoked' });
  return (
    <AlertDialog
      isOpen={provisioner !== null}
      onOpenChange={open => {
        if (!open) onClose();
      }}
      title={`Återkalla nyckeln för ${shown?.label ?? 'katalogen'}`}
      description="Katalogen kan inte längre föra in ändringar i Clew, och den försvinner från den här sidan. Personer och enheter som redan finns ligger kvar, och den som slutar eller byter enhet behåller sin åtkomst tills en katalog läser in igen."
      actionLabel="Återkalla"
      cancelLabel="Avbryt"
      isActionLoading={busy}
      onAction={() =>
        run(async () => {
          if (!provisioner) return;
          let done: string | undefined;
          try {
            client.setQueryData(keys.admin.users, await api.admin.revokeProvisioner(provisioner.id));
            done = `Nyckeln för ${provisioner.label} är återkallad.`;
          } catch (e) {
            // A confirmation has no place for an error. It closes, and the page says what happened in a notice that
            // stays until it is dismissed (4.1.3). The list is read first: a catalogue somebody else took the key
            // back from is gone from it, which is the usual reason the server said no.
            await client.invalidateQueries({ queryKey: keys.admin.users });
            toast({
              body: errorMessage(e, 'Nyckeln kunde inte återkallas.'),
              isAutoHide: false,
              uniqueID: 'provisioner:revoked',
            });
          }
          onClose();
          onDone();
          return done;
        })
      }
    />
  );
}
