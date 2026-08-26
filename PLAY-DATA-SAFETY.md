# Google Play Data Safety form — Weftling

Fill the Play Console **Data safety** form with the answers below. They're
derived from what the code actually does (no analytics/ads SDKs — confirmed
from the CSP allowlist; auth via Supabase; records in Supabase Postgres;
Xero/QuickBooks via Nango; payments via Google Play). Company: **Newbury
Consulting LLC**. Privacy policy URL: **https://weftling.vercel.app/privacy.html**.

Re-check this if you later add analytics, crash reporting, ads, or any new
third-party SDK — those change the answers.

---

## Overview answers

- **Does your app collect or share any of the required user data types?** → **Yes**
- **Is all of the user data collected by your app encrypted in transit?** → **Yes** (HTTPS + HSTS)
- **Do you provide a way for users to request that their data be deleted?** → **Yes** — in-app (Settings → Delete account) and web (https://weftling.vercel.app/delete-account.html)

## Data types — COLLECTED (leaves the device to your servers)

For each: Collected = Yes, Shared = No (see "shared" note below), Processed
ephemerally = No (it's stored), Required (not optional) unless noted, Purpose =
**App functionality** (and **Account management** for the email).

| Data type | Category | Notes |
|---|---|---|
| Email address | Personal info | Your account login. Purpose: App functionality + Account management. |
| Name | Personal info | The names of the user's own customers, stored in clients. Declare it — it's third-party PII you store. |
| Other personal info | Personal info | Customer email addresses stored in clients (if the user enters them). Optional. |
| Other financial info | Financial info | Hourly rates, material costs, invoice amounts/records. NOT payment info — see below. Purpose: App functionality. |
| User IDs | Personal info | The account identifier (optional to declare; it's the auth user id). Purpose: App functionality. |

**Purchases / payment info:** Do **not** declare payment info as collected by
your app — Google Play billing handles it and the app never receives card
details. (In the store listing you separately mark the app as paid / having
in-app purchases; that's not the Data Safety "Financial info: payment info"
toggle.)

## Data types — NOT collected

Location, contacts, photos/videos, files/docs, calendar, messages, health,
web browsing history, app activity/analytics, crash logs, device identifiers,
advertising ID. The app uses **no analytics, ads, or tracking SDKs**.

## The "Shared" question (important nuance)

Google defines **"shared"** as transferring data to a *third party* — and
explicitly **excludes** (a) transfers to **service providers** processing on
your behalf, and (b) transfers the **user initiates** or is clearly notified of.

- Supabase, Vercel, Nango = your **service providers/processors** → NOT "sharing".
- Xero / QuickBooks = data goes there only when **the user connects them and
  acts** (user-initiated) → NOT "sharing" in Play's sense.

So answer **Shared = No** for every data type. (Your privacy policy still
discloses all these processors, which is correct and separate.)

## Security practices section

- **Encrypted in transit:** Yes.
- **Users can request data deletion:** Yes (link the deletion URL above).
- **Committed to Play Families policy:** No (not a kids' app).
- **Independent security review:** optional — you can say No; a self-review
  (SECURITY-REVIEW-PRELAUNCH.md) isn't the third-party audit this refers to.

---

## Also required elsewhere in the Console (not the Data Safety form itself)

- **App content → Privacy policy:** https://weftling.vercel.app/privacy.html
- **App access:** the app is fully behind a login — provide Google review a
  **test account** (email + password) so they can get past the sign-in screen,
  or they'll reject it as "can't access the app".
- **Account deletion URL** (App content → Data deletion): https://weftling.vercel.app/delete-account.html
