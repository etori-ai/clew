# Review: manager statistics and reading Qlik directly · 2026-11-06

Date: 2026-11-06

Status: review and recommendation; no decision changed, nothing built

## Question

The product owner asked how big-boss-board gets sick-leave and economy statistics today, through cron jobs against a
disk, whether the data can be read directly from Qlik instead, and whether the municipality runs that service.

## Assessment

Yes, the municipality runs Qlik Sense itself, and a direct read is technically possible. But it does not remove the
hard part. The export gives a small, already aggregated feed; a direct read exchanges a fragile file transport for a
service identity in Qlik, a health-data access review and a new way to keep month-end history. The file format is the
stable part and should survive whichever transport is chosen.

Recommendation: keep `Period,Enhet,Mått,Kolumn,Mätvärde` as the contract, and first ask the Qlik owners for a
förvaltning-level object in the Kommun environment. Read that object over the Engine API if a service identity can be
agreed. If it cannot, keep the file feed, because going to the data warehouse would copy measure definitions out of
Qlik.

## How it works today

```
payroll and finance sources
  → data warehouse on SQL Server (sadb051: DW_MART, EDW)
  → Qlik Sense apps (not traced; see open questions)
  → a Qlik export built by the supplier Mindcamp, daily
  → \\saas066.personal.sundsvall.se\Kommun\kpidata_{RR,Personal}_förvaltning_YYYY-MM-DD.csv
  → CronJob import-ekonomi 07:00, import-sjukfranvaro 07:20, Europe/Stockholm
      python -m app.smb_import --kind … (NTLM service account, SMB3 encryption)
  → POST /api/import/{kind}-filer on the backend with an import token
  → PostgreSQL, drawn by the big-boss-board dashboard
```

| Fact | Evidence |
|---|---|
| Import transport and rules are separate; the job holds no business rules | `backend/app/report_import.py`, `smb_import.py`, `docs/DEPLOY.md` in big-boss-board |
| The CronJobs are `suspend: true` with a manual first run | Local copy of `envs/prod/bbb/import-*.yaml`. It is not a git checkout and may be stale; live state not verified |
| A personnel file is about 300 rows: 12 measures (`SK.P.SJ.*`, `.AM.*`, `.MA.*`, `.AC.*`) over 9 units | Measured on a local sample; no individuals in it |
| Each run sends every matching file; the share's directory limit was raised to 50 000 entries | `docs/DEPLOY.md`, commit `ad2e69d` |
| A month-end is chosen from daily extracts (latest extract day 1–9 of the next month), and the economy series is built from several extracts | `docs/ARCHITECTURE.md`, `ekonomi_import.py` |
| The source question (Qlik or data warehouse) was sent to the steering group; the outcome is not recorded | Item 4 in `backend/app/seed.py` |
| The existing Stratsys export was too detailed on sick leave, so a förvaltning-level export was requested from Mindcamp | The same item |

The thresholds, the cost estimate and the assessment of a figure are big-boss-board's rules, not Qlik's. Its own
architecture document also says that the production extract's R12 basis must still be confirmed with the data owner.

## What runs on the Qlik side

Sundsvall runs **Qlik Sense Enterprise on Windows**, on its own servers: production at `beslutsstod.sundsvall.se`, test
at `saas713.personal.sundsvall.se`. A read-only test on 2026-08-21 used Windows authentication and met a self-signed
certificate. That test belongs to the consultant work for the municipal companies in `bi-qlik-bolagen`, which never
connects to production. It says nothing about the Kommun apps behind this export.

## Options

| | A. Keep the file feed | B. Qlik Engine API | C. Data warehouse | D. Read big-boss-board |
|---|---|---|---|---|
| What it is | SMB as today, optionally read by a connector | WebSocket JSON-RPC to one dedicated aggregate object | `api-service-datawarehousereader` or a view | A read API over its PostgreSQL |
| Measure definitions | Qlik, same as Stratsys | Qlik, same as Stratsys | **Reimplemented or moved** | Qlik, plus its rules |
| Fragility | Filename, finished-file guess, growing share, NTLM | Service identity, engine load, object changes | New mart or endpoint to run | Depends on another product |
| Access to health data | Already reduced to förvaltning | Only safe with a dedicated object; a full app holds far more | Only safe with a reviewed view | Already reduced |
| History | Daily files are the snapshots | Unknown: must be proved against the data model | Depends on the mart | Already held |
| New work outside Clew | None | Qlik object, service identity, licence check | Warehouse team and a new endpoint | A read API and authorization |
| Fit with Clew | Reviewed aggregate feed | Reviewed aggregate feed, if the object is reviewed | The path `integrations.md` names, but the reader has no HR or economy KPI resource today | A dependency on a system Clew may replace |

**The auth point in B.** Windows authentication is what worked by hand. A Linux container on OpenShift needs a
non-personal identity instead, normally a JWT virtual proxy or client certificates, which the Qlik repository
deliberately avoided for its own use. This comes from general product knowledge and was not tested here; a Qlik
administrator must confirm it, along with what licence such a service user takes.

**The history point in B.** Today's series is built partly because each extract holds a limited window, and the
dated files are the record of what the month looked like at closing. A live read answers what Qlik shows now. If the
app cannot answer per closed month, the connector must store its own monthly snapshot, or the historic series
changes without notice.

**The boundary.** Clew's rule is that aggregates over personal data are produced inside the source's trust boundary,
never by Clew reading rows with a service account (`docs/architecture/integration-paths.md`). Sick leave is health
data. So B may not mean "a service account that can open Personalanalys": it means one aggregate object whose
access is limited to that. Persona UC-EVA-1 also expects a minimum group size if this ever goes below förvaltning,
and neither export nor app has been checked for that.

## In Clew

- The feed fits a derived connector in its own container: a scheduled read, a stored snapshot with period, source and
  checked-at time.
- Qlik is proprietary but it is a source, like Microsoft 365, so the open-source rule holds if the connector is
  optional and Clew runs without it. `enigma.js` is MIT (2.15.0 checked); nothing in the repository may need Qlik.
- A figure needs D54 accepted, and a trend needs a `series` decision (D38 leaves it open). Without them, the statistics
  have nothing to be drawn with.
- The dialogue page's activities and notes are a separate question: the ownership ladder in `docs/vision.md` needs a
  numbered decision before Clew holds them.

## Open questions

1. What did the steering group decide on item 4, and who owns the Kommun Qlik apps now?
2. Which Qlik app and task writes `kpidata_*`? No repository in the organisation shows it.
3. Does the Kommun Qlik app hold closed months, or only the current state?
4. Does Qlik accept a service identity from OpenShift, and what does it cost in licence?
5. Who owns the access review for sick-leave figures in a new consumer?
6. Is big-boss-board replaced by Clew, or do they run side by side? This decides whether option D is a bridge or a
   dead end.

## Not verified

Argo CD required a login and `oc` was unauthorized, so the live CronJobs, their last runs and the real SMB content
were not seen. Qlik and SQL Server were not reachable from this machine, which proves nothing about the cluster. No
Qlik app was opened, and that the export runs from the Kommun apps is inferred from the code, the filenames and item 4.
