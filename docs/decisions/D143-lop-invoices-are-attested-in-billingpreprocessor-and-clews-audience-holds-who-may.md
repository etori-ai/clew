# D143 · Lön och pension's invoices are attested in BillingPreprocessor through a connector of their own, and Clew's audience holds who may

**Status:** proposed (2026-11-24; the connector is built on made-up records and has met neither BillingPreprocessor nor the gateway; provisional once the product owner and Lön och pension have chosen the rule in item 3, accepted once one attest has gone through the test gateway and been read back) · **Date:** 2026-11-24 · **Area:** integrations, identity

**Decision.** A person who attests Lön och pension's invoices in Draken can attest them in Clew too.

1. **The connector is to BillingPreprocessor.** Draken's Lön och pension lists the billing records of the category
   `SALARY_AND_PENSION` in BillingPreprocessor and attests one by changing its status. SupportManagement only holds a
   tag on the errand that points at the record, and Raindance receives a record only after it is attested, on its
   `transferDate`. So the record and its decision live in BillingPreprocessor, and the connector `billing`
   (`connectors/billing/`) talks to it. Per D35, it is one connector per system. It does not extend `sm`, and it
   does not reach Raindance.
2. **The decision is written as Draken writes it.** Attest sets `status: APPROVED`. Reject sets `REJECTED`. Each sets
   `approvedBy` to the person's name, and attest also sets the invoice's `ourReference` to that name. The connector
   reads the record right before the `PUT`, because the API replaces the whole record and has no version to send, and
   sends it shaped as Draken shapes it (`satisfyApi`): the fields a person may set, without the id, the dates, the
   totals and an internal record's recipient, which the API refuses. It reads the record back after the write. A write whose answer is missing is `unknown` and is not sent again, and
   `billing.lookup` settles it from the record (D45). The undo, `billing.reopen`, puts the record back to `NEW` with
   the reference it had. It works only while the record has not left for Raindance.
3. **Who may attest is Clew's audience, the same rule as Draken's.** Draken lets the role `draken_superadmin` attest.
   That role comes from one AD group (`SUPERADMIN_GROUP`) and is checked in Draken's own backend. BillingPreprocessor
   is called with Draken's client credential, so as far as is known it checks no person. The connector does the same
   with its own gateway credential, so it cannot tell who may attest either. The connector's audience on
   Administration › Anslutna system is therefore set to that group, provisioned into Clew. Clew checks it on every
   call, so a person who has left the group by the time a decision is sent is refused (`authority-revoked`). The
   connector's capabilities have no role scope (`scope: {}`). The rule is Draken's, carried over. Whether one group
   for every record is the right attest rule is for Lön och pension and the economy side to decide, not Clew.
4. **The person is named to the source.** Every call carries `X-Sent-By: type=adAccount; <userName>` as Draken sends
   it, with the SCIM `userName` from the actor. A person provisioned without a user name reads nothing and decides
   nothing.
5. **One work item, with what Draken's list shows of each record.** The scan gives everyone in the audience the same
   card, "Attestera n fakturor". It is a shared queue, as in Draken: one person's decision takes the record off the
   others' cards at their next scan. A row is named as Draken's attest list names a record. The label is the cost type
   and the amount. The detail is the manager who ordered it (`extraParameters.referenceName`, which Draken calls
   "Chef"), the customer by name, the first invoice row as "antal × á-pris" with any further row by its text, and the
   errand number. The manager's name is the only name stored in Clew, as a work item's text. It is a manager's name in
   their role, and Draken shows it in its list. Nothing in the connector is offered to the model (`model: false`).
   These are outgoing internal invoices, not supplier invoices, so they are not joined with other invoices in a shared
   profile. Att göra already lists them beside every other system's work.
6. **Each record is reviewed before it is attested.** Attest is the work item's review one at a time (D70): each
   record is drawn as one page by `billing.preview` (cost type, customer, manager, errand, dates, rows with their
   coding, the sum), and the write happens once at the end with the records the person approved. Reject stays one
   press on the chosen rows, with a question first.
7. **A customer is named from Draken's own table.** BillingPreprocessor answers a customer number only. Draken names
   it from a table in its own code for each year (`invoiceData-<year>.ts`). The connector takes the same table as
   configuration (`BILLING_CUSTOMERS`, per type, since internal and external numbers overlap), so it has to be updated
   when Draken's is. A number the table does not hold is shown as "Kundnummer n". The table is the installation's
   and is not in this repository.

**Why.** Lön och pension asked to attest from Clew as well as from Draken (2026-11-24). Reading Draken
(`web-app-draken-public`, `billing.controller.ts`, `authorization.service.ts`) showed where the decision lives and
who may make it.

**Open.**

- Does BillingPreprocessor use `X-Sent-By` for anything but its log? If it checks the person, item 3 can lean on it.
- Does BillingPreprocessor accept a record going back from `APPROVED` or `REJECTED` to `NEW` (the undo)? Draken's own
  update allows `NEW`, but the API's rules are not known.
- Which gateway credential the connector gets, and on which environment it is tried first.
- What `REJECTED` means for the errand in Draken afterwards.
- Where the customer table should come from in the long run: Draken's code, a shared configuration, or an API that
  names a customer number.
- Draken lets the attester correct a record before attesting it. Clew does not (D80 could, for up to 12 fields);
  whether Lön och pension wants it is not asked yet.
