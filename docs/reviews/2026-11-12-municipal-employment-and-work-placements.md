# Municipal employment, work placements and managerial responsibility

On 2026-11-12 we chose to distinguish the unit that holds a job from the units where its holder works. A person may hold several employments, so each work placement belongs to a particular employment. The home unit supplies the ordinary case without anyone entering the same unit twice. [Decision D114](../decisions/D114-person-profiles-show-employments-and-categorised-phone-numbers.md#employment-and-work-placement-in-a-municipality)

## Why a home unit alone is insufficient

Nacka advertised one teaching post in its mother-tongue unit with teaching at several schools. Recording an employment for every school would turn one job into several. Rättvik describes hourly care workers whom its staffing unit employs and books to work at units where they have had an introduction. Moving a worker's home unit with each booking would lose the link to the staffing unit. [Nacka municipality, teaching post 2026/729](https://www.nacka.se/jobb-vuxenutbildning/om-att-jobba-i-nacka/lediga-jobb-hos-nackas-kommunala-skolor/V_983907/modersmalslarare-i-finska-pa-25-till-modersmalsenheten-nacka-kommun/) · [Rättvik municipality, care staffing 2026/117](https://rattvik.varbi.com/se/what:job/jobID:978488/)

## What changes when someone moves

| Example | What the directory needs to express |
|---|---|
| Hassan's job moves from Hemtjänst Centrum to Hemtjänst Norr, where he will also work. | Change the home unit on that employment once. Requiring the same change to a person's `department` would let the two entries drift apart. |
| Hassan works at Norr for the autumn and retains his job at Centrum. | Keep Centrum as the employment's home. Record Norr as the work placement for the autumn. Its end date closes that posting. |
| A teacher from a central unit teaches at three schools this term. | The same employment has three concurrent work placements. Each school can identify who works there. The teacher's reporting line needs the municipality's record of managerial responsibility. |
| The head of Finance hands responsibility for HR to another manager. | End the managerial responsibility for HR. The employment in Finance continues. A permission such as `admin.users` follows the person's authorised groups independently. |

## What Clew can establish today

The synthetic directory records Hassan's unit twice. His employment supplies the profile. The provisioner separately reads his `department` to set unit group membership. Changing only his employment would move the unit shown on his profile while leaving his Clew assignment at Centrum. Clew derives today's `employee` and `manager` assignments and its grant from group memberships. These assignments also feed the reporting line used for development talks. Treating every visiting worker as a direct report of the host manager would therefore change who appears in those talks. [Synthetic directory](../../scripts/provisioner/directory.ts) · [Provisioner mapping](../../scripts/provisioner/push.ts) · [Identity and reporting lines](../architecture/identity.md#derivation)

The first municipal mapping needs to show how the source identifies an employment when two jobs share a unit, what dates or bookings establish a placement, and which source identifies the manager responsible for the employee. D114 currently sends a list of employments without individual IDs. The municipal examples establish the need for the distinction. They leave the SCIM representation and any rules granting access to a host unit open.
