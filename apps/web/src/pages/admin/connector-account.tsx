import { useEffect, useState } from 'react';
import type { LinkedAccountAdminView } from '@clew/contracts';
import {
  Banner,
  Button,
  CodeBlock,
  Dialog,
  DialogHeader,
  FormLayout,
  HStack,
  Heading,
  List,
  ListItem,
  MetadataList,
  MetadataListItem,
  StatusDot,
  Text,
  TextInput,
  Timestamp,
  VStack,
} from '@clew/ui';
import { api } from '../../api';
import { DialogFrame } from '../../components/shell/dialog-frame';
import { DOT } from '../../dot';
import {
  ACCOUNTS_HEADING,
  accountForm,
  accountNotice,
  approvalOf,
  clientWords,
  draftOf,
  draftReady,
  keepsSecret,
  originWords,
  peopleWords,
  serverReview,
  type AccountDraft,
  type ReviewRow,
} from '../../admin-account';

/**
 * A connector's linked account on its administrator's page (D147 items 3 and 4), drawn as the canvas of 2026-11-25
 * chose (A): the facts under Översikt, a notice of the page's own kind while nobody can link or while the system names
 * another server, and two dialogs: the one that asks for a client and, for a system that names no server, its
 * addresses; and the review of the server a system names. The words and the rules are `admin-account.ts`.
 */
type Account = LinkedAccountAdminView;
/** The page's own way to run an action: it re-reads the administration's queries and says what was done. */
type Run = (action: () => Promise<string | void>) => Promise<void>;
export type AccountDialog = 'enter' | 'review' | null;

/** The id of the block's button, which takes the focus back when a dialog it opened closes. */
export const ACCOUNT_CHANGE_ID = 'connector-account-change';

/** The rows of a review, each beginning with what its dot says, so the dot is decoration and is heard once. */
export function ReviewRows({ rows }: { rows: ReviewRow[] }) {
  return (
    <>
      {rows.map(row => (
        <ListItem
          key={row.key}
          startContent={<StatusDot variant={row.tone} label={row.dot} aria-hidden />}
          label={<Text>{row.label}</Text>}
          description={
            row.lines.length ? (
              <VStack gap={0}>
                {row.lines.map(line => (
                  <Text key={line} type="supporting">
                    {line}
                  </Text>
                ))}
              </VStack>
            ) : undefined
          }
        />
      ))}
    </>
  );
}

/** The notice over the page, with the one way on. */
export function AccountNotice({
  source,
  account,
  onOpen,
}: {
  source: string;
  account: Account | null | undefined;
  onOpen: (dialog: 'enter' | 'review') => void;
}) {
  const notice = accountNotice(source, account);
  if (!notice) return null;
  return (
    <Banner
      status="warning"
      container="section"
      collapsible={false}
      title={notice.title}
      description={notice.description}
      endContent={<Button variant="secondary" size="sm" label={notice.label} onClick={() => onOpen(notice.action)} />}
    />
  );
}

/** "Personernas konton" under Översikt: where people are sent, how Clew is known there, and how many have linked. */
export function AccountFacts({
  account,
  mobile,
  onChange,
}: {
  account: Account;
  mobile: boolean;
  onChange: () => void;
}) {
  const approved = account.approved;
  return (
    <VStack gap={3}>
      <HStack gap={3} vAlign="center" justify="between" wrap="wrap">
        <Heading level={3} accessibilityLevel={2}>
          {ACCOUNTS_HEADING}
        </Heading>
        <Button
          id={ACCOUNT_CHANGE_ID}
          size="sm"
          variant="secondary"
          label="Ändra"
          aria-label="Ändra personernas konton"
          onClick={onChange}
        />
      </HStack>
      <MetadataList columns={mobile ? 'single' : 'multi'}>
        <MetadataListItem label="Personer loggar in hos">
          {approved ? (
            <VStack gap={0}>
              <Text>{approved.issuer}</Text>
              <Text type="supporting" color="secondary">
                {originWords(approved.origin)}
              </Text>
            </VStack>
          ) : (
            'Inget är godkänt'
          )}
        </MetadataListItem>
        <MetadataListItem label="Clew hos systemet">{clientWords(account)}</MetadataListItem>
        {approved && (
          <MetadataListItem label="Får besked när en koppling tas bort">
            {approved.revocationEndpoint ? 'Ja' : 'Nej'}
          </MetadataListItem>
        )}
        <MetadataListItem label="Personer">{peopleWords(account.people)}</MetadataListItem>
        {approved && (
          <MetadataListItem label="Godkänt">
            {approved.by}
            {DOT}
            <Timestamp value={approved.at} format="date_time" />
          </MetadataListItem>
        )}
      </MetadataList>
    </VStack>
  );
}

/**
 * The two dialogs. Both frames and their headers are always rendered, since a Dialog takes its name from a title
 * present when it mounts; only their content waits for the account.
 */
export function AccountDialogs({
  id,
  source,
  account,
  open,
  onClose,
  run,
  busy,
  error,
}: {
  id: string;
  source: string;
  account: Account | null | undefined;
  open: AccountDialog;
  onClose: () => void;
  run: Run;
  busy: boolean;
  error: string | null;
}) {
  const [draft, setDraft] = useState<AccountDraft | null>(null);
  // The fields are what is approved when the dialog opens, and a secret never outlives the dialog.
  useEffect(() => {
    setDraft(open === 'enter' && account ? draftOf(account) : null);
  }, [open === 'enter', account?.connectorId]);
  const set = (field: keyof AccountDraft) => (value: string) =>
    setDraft(current => (current ? { ...current, [field]: value } : current));
  const form = account ? accountForm(account) : null;
  const review = account ? serverReview(account) : null;
  const approve = (input: Parameters<typeof api.admin.approveAccount>[1], said: string) =>
    run(async () => {
      await api.admin.approveAccount(id, input);
      onClose();
      return said;
    });
  return (
    <>
      <Dialog
        isOpen={open === 'enter'}
        onOpenChange={isOpen => {
          if (!isOpen) onClose();
        }}
        width={560}
        purpose="form"
      >
        <DialogFrame
          error={open === 'enter' ? error : null}
          header={
            <DialogHeader
              title={`Personernas konton i ${source}`}
              subtitle={`Registrera Clew som klient i ${source} med adressen nedan, och ange sedan det ${source} ger dig.`}
              onOpenChange={onClose}
              hasDivider={false}
            />
          }
          secondary={<Button variant="ghost" label="Avbryt" onClick={onClose} />}
          primary={
            <Button
              variant="primary"
              label="Spara och godkänn"
              isDisabled={busy || !account || !draft || !draftReady(account, draft)}
              clickAction={async () => {
                if (account && draft) await approve(approvalOf(account, draft), 'Uppgifterna är sparade och godkända.');
              }}
            />
          }
        >
          {account && draft && form && (
            <VStack gap={4}>
              <CodeBlock code={account.returnAddress} title={`Adress att ange i ${source}`} isWrapped width="100%" />
              {!form.addresses && (account.found ?? account.approved) && (
                <MetadataList columns="single">
                  <MetadataListItem label="Personer loggar in hos">
                    <VStack gap={0}>
                      <Text>{account.found?.issuer ?? account.approved?.issuer}</Text>
                      <Text type="supporting" color="secondary">
                        {originWords('discovered')}
                      </Text>
                    </VStack>
                  </MetadataListItem>
                </MetadataList>
              )}
              <FormLayout>
                <TextInput
                  label="Klientens id"
                  value={draft.clientId}
                  onChange={set('clientId')}
                  isRequired={form.clientRequired}
                  autoComplete="off"
                  {...(form.clientRequired
                    ? {}
                    : { description: 'Lämna tomt om Clew ska registrera sig själv hos systemet.' })}
                />
                <TextInput
                  label="Klientens hemlighet"
                  type="password"
                  value={draft.secret}
                  onChange={set('secret')}
                  description={
                    keepsSecret(account, draft)
                      ? 'Lämna tom för att behålla den som är sparad. Den visas aldrig igen.'
                      : 'Sparas förseglad och visas aldrig igen.'
                  }
                  isRequired={form.addresses && !keepsSecret(account, draft)}
                  autoComplete="new-password"
                />
                {form.addresses && (
                  <>
                    <TextInput
                      label="Adress där personer loggar in"
                      value={draft.authorize}
                      onChange={set('authorize')}
                      isRequired
                      autoComplete="off"
                    />
                    <TextInput
                      label="Adress där Clew hämtar kontot"
                      value={draft.token}
                      onChange={set('token')}
                      isRequired
                      autoComplete="off"
                    />
                    <TextInput
                      label="Adress för att ta bort en koppling"
                      value={draft.revoke}
                      onChange={set('revoke')}
                      description="Lämna tom om systemet saknar en. Personen tar då själv bort Clew i systemet."
                      autoComplete="off"
                    />
                  </>
                )}
              </FormLayout>
            </VStack>
          )}
        </DialogFrame>
      </Dialog>
      <Dialog
        isOpen={open === 'review'}
        onOpenChange={isOpen => {
          if (!isOpen) onClose();
        }}
        width={520}
      >
        <DialogFrame
          error={open === 'review' ? error : null}
          scrollLabel="Det som ändras"
          header={
            <DialogHeader
              title={review?.title ?? 'Godkänn var personer loggar in'}
              subtitle={review?.subtitle ?? ''}
              onOpenChange={onClose}
              hasDivider={false}
            />
          }
          secondary={<Button variant="ghost" label={review?.keep ?? 'Inte nu'} onClick={onClose} />}
          primary={
            <Button
              variant="primary"
              label={review?.approve ?? 'Godkänn'}
              isDisabled={busy || !review}
              clickAction={() => approve({}, 'Inloggningsservern är godkänd.')}
            />
          }
        >
          {review && (
            <List density="compact" aria-label="Ändringar">
              <ReviewRows rows={review.rows} />
            </List>
          )}
        </DialogFrame>
      </Dialog>
    </>
  );
}
