# SCIM rollout questions

Use these questions to agree how your organisation will meet the [SCIM contract](provisioning-for-operations.md). Record the local decision, its owner and a representative source record. The [school walkthrough](scim-school-walkthrough.md) supplies an example directory and expected results.

## Which source fields identify a person and a unit?

**Directory team.** Choose person and unit IDs that survive renames and reorganisations. Record which source supplies the unit name and parent ID. Include an example of moving an existing unit.

## Who is responsible for each employee?

**Directory and HR teams.** Identify the unit a person belongs to and the unit each manager leads. Agree who sends the effective start and end of a second assignment or acting manager role. A temporary work location alone does not establish a reporting line.

## Who should be active in Clew?

**HR and identity teams.** Agree which employees, substitutes and consultants are in scope. Map each source status to continued access or deactivation, including leave and gaps between assignments. If several writers supply people, assign separate identifiers and ownership of whole groups.

## Which profile data may colleagues see?

**Directory and HR teams.** List the email address, phone categories and employment details approved for publication. Identify who can correct a published value in the source.

## How will changes reach Clew?

**Directory team.** Identify the event stream, change log or polling process, the daily full comparison and the operator who handles rejected changes.

## Which account claim matches the SCIM userName?

**Directory and identity teams.** Check one ID token and its matching user in the test installation. Agree how to coordinate renames and account-name reuse, preserve account subjects on return and disable a leaver’s account. See the [account-name handover](scim-sign-in-and-hosting.md#handing-an-account-name-to-another-person).

## Who provides the test address and credentials?

**Hosting team and Clew administrator.** Name the owners of the HTTPS endpoint, the provisioner token, its rotation and the test installation used for acceptance.

## For a later municipal mapping

If the source distinguishes two jobs on the same unit, temporary work locations or a manager responsible for an individual employee, bring sample records. These inform future support. The current employment extension has no employment ID and the provisioner assigns reporting responsibility through groups. [Municipal mapping review](../reviews/2026-11-12-municipal-employment-and-work-placements.md)

## Not decided yet

These are open on Clew's side and change what is sent or how an installation is run. They are listed with the [open questions](../maintainers/open-questions.md).

- Whether people who are not meant to sign in should be sent at all. Sending a User creates a local person. Usable access requires the person to be active (`active: true`), a unit assignment and a matching identity at sign-in.
- Whether Clew may hold the fact that a person is protected. Until it is answered, do not send it.
- Whether a person with several placements can switch between them. Today they act as one: a unit they lead before a unit they work in, then the unit id that comes first when the ids are compared character by character, by each character's code and with no regard to language. So `10` comes before `9`, `Z-skola` before `a-skola`, `Skola` before `förskola`, and `skola-2` before `skola_2`.
- Whether one installation can hold several organisations. Today it is one.
