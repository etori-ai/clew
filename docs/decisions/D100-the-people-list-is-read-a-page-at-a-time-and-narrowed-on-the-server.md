# D100 · The people list is read a page at a time and narrowed on the server

**Status:** accepted (product owner, 2026-11-11: the list of Administration › Användare is paged and filtered, and where a person is placed is told apart from whether they are a manager or an employee), built 2026-11-11 and tried signed in on the development stack the same day; items 3, 5 and 6 are choices made in the build and stand until he says otherwise; no manual screen-reader pass yet · **Date:** 2026-11-11 · **Area:** ui, identity

**Decision.** Administration › Användare reads its people a page at a time. The server narrows, orders and counts;
the browser never holds the organisation.

1. **One read for a page.** `POST /api/admin/users/search` takes `UsersAdminQuery` and answers `UsersAdminPage`
   (`packages/contracts/src/index.ts`): the rows of the page, how many match, how many there are, and the page that
   was read. `GET /api/admin/users` keeps the catalogue's state, the group-to-capability rows and what the editor and
   the filters offer, and no longer carries people. The use case is `usersAdminUsecases.people` in
   `apps/server/src/modules/people/usecases.ts`, behind `admin.users` as the rest of the page; it writes nothing, so
   it has no audit row. The store narrows through one port, `ProvisionTx.searchUsers`, held to the same behaviour on
   both adapters by `tests/scim-store-contract.ts`, and only the rows of the page are filled in with units, grant
   and binding. A row carries what the list shows and nothing else, so a person's groups are not read for it.
2. **What narrows the list.** Words, a unit, a role, a status and a capability; every part narrows further. A word
   matches without regard to case somewhere in the name, the user name or the e-mail, and each word must match. The
   status is the row's own reading of access (`USER_STATUSES`): deactivated, no access (no unit, so no grant, D68),
   signed in, not signed in yet. The capability is one on the grant. On PostgreSQL the words are matched under the
   ICU collation `sv-x-icu`, the one the order asks for, so å, ä and ö fold the same in a database created with the
   locale C as in any other. The page holds what it sends to the limits of `USERS_QUERY_LIMITS`: the search box takes
   no more than the server reads, and an address that names more is read as naming nothing.
3. **A unit is asked for with everything below it.** The unit filter matches a person placed on the unit or on any
   unit under it in the tree (D99; `branchOf` in `modules/people/domain.ts`). An administrator who picks an
   administration means the people in it, and Organisation already shows who is placed on exactly one unit. With a
   role, the two are one placement: "managers in Barn och utbildning" is the people who lead a unit of that branch,
   not a person who leads something elsewhere and is an employee here.
4. **Place and role are two columns and two filters.** The column "Enhet och roll" is now Enhet and Roll, and each
   unit a person is placed on is a line in both, the one they act as first. Nobody's second placement is behind a
   "(+1)". The column that counted a person's groups is gone: a number nobody could act on, and the width was needed.
5. **The filters are in the address, the typed search is not.** `/admin/users?unit=…&role=manager&status=no-access&capability=admin.users&page=2&size=50`
   (D43: English names and values). A narrowed list can be linked, as Organisation now links its "saknar enhet"
   warning to `?status=no-access`, and Back undoes a step. The search text is a person's name, so it is sent in the
   request body and never becomes part of an address, a browser history or an access log: the same reason SCIM has
   `POST /.search` (RFC 7644 §3.4.3). The cost is that a reload forgets the typed search. A change that leaves the
   address as it is writes nothing, so one choice is one step back. A value the address names and the options do not
   hold, such as a unit that has left the tree, still narrows the list, and its chip says so by the value itself.
6. **Pages of 25, 50 or 100, by name.** The order is name in Swedish order and then id, the same on every page, so
   nobody is on two pages and nobody is missing. A page past the end, which an old link or a list that became
   shorter leaves behind, answers with the last page. Changing a filter starts again from the first page.
7. **Astryx only.** The bar above the list is Astryx's filter-bar pattern (`ToolbarTableFilter`): a search box, then
   one `Selector` per field that is its own chip, the bare field name unset and the whole clause once set
   ("Roll: Chef") with its clear beside it, in a wrapping `HStack` so the chips move to a second line on a phone.
   The template's own StyleX is not copied. Under the list `Pagination`, numbered pages with a page-size choice on a
   desktop and "Sida 2 av 11" on a phone, shared by the `Table` and the phone's `List`; the table says each row's
   place among all the people (`rowIndexStart`, `rowCount`). The line that counts ("46 av 255 personer") is a status
   that is read out when it changes. A step to another page brings the head of the list into view and leaves the
   focus on the pager. Rensa filter is gone once used, so it leaves the focus on the search box. A list that cannot
   be read keeps its search and filters and says why where the rows would be.

**Why.** The page read every person and, for each, four more rows: a thousand reads for the development directory's
two hundred and fifty people, repeated after every change to the mapping, and all of them drawn at once. A
municipality has thousands. Narrowing in the browser would need the whole organisation in it first, so the store
does it: with the directory in PostgreSQL a page of 25 answers in about 10 ms and a page of 100 in about 30 ms,
whatever the filter. The order needs Swedish letters in their place (å, ä, ö after z), which PostgreSQL gives
through the ICU collation `sv-x-icu`; the memory adapter sorts with `Intl` and the contract case holds the two
together.

Weighed and not chosen: a cursor instead of page numbers (an administrator wants to see how many there are and jump);
Astryx's `useTablePagination` plugin (it belongs to the table, and the phone's list needs the same pager); a
SegmentedControl for the role (two choices, but it truncates on a phone and would be the one filter that looks
unlike the others); the search in the address (a name in every log on the way).

**Not built.** Sorting by anything but name. A person's own page or overlay, which is where their groups would be
read now that the count is gone. An export of the narrowed list. The three reads per row are not batched; at 100
rows that is 300 small reads in one transaction, and the place to batch if it ever shows.

**Replaces.** Nothing numbered. It changes the unpaged list built as step 8 of the SCIM order of work (D85's page,
HANDOVER 2026-11-09) and the contract `UsersAdminOverview`, which loses `users` and gains `units`.
