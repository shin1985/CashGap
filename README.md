# CashGap

CashGap is a fiscal-year-based cash management dashboard built from the uploaded `financial-dashboard-v2.jsx` reference and reworked into a React project.

## What changed

- Renamed the tool to **CashGap**.
- Fixed the PL / BS fragment crash by using `Fragment` import correctly.
- Fixed the BS cash bug by using the fiscal year-end balance directly, including the case where it is exactly `0`.
- Reworked non-operating income / expense logic to use explicit `subtype` values instead of depending on row order.
- Applied the fiscal year start month to **all month labels and yearly views**, so the UI now works as a real fiscal-year dashboard instead of being locked to January to December.
- Added delete actions for manual income rows, expense rows, and PL rows.
- Removed unused UI-only settings to keep the interface simpler.
- Added Google Drive / Google Sheets persistence without using an app-side database.

## Stack

- React + Vite
- Google Identity Services
- Google Picker
- Google Drive API
- Google Sheets API

## Setup

1. Create a Google Cloud project.
2. Enable these APIs:
   - Google Drive API
   - Google Sheets API
   - Google Picker API
3. Create a Web OAuth client ID.
4. Create an API key.
5. Copy the Cloud project number.
6. Copy `.env.example` to `.env.local` and fill in the values.

```bash
cp .env.example .env.local
npm install
npm run dev
```

## Required environment variables

```bash
VITE_GOOGLE_CLIENT_ID=YOUR_GOOGLE_OAUTH_CLIENT_ID
VITE_GOOGLE_API_KEY=YOUR_GOOGLE_API_KEY
VITE_GOOGLE_APP_ID=YOUR_GOOGLE_CLOUD_PROJECT_NUMBER
```

## Storage behavior

- The app does not use its own backend database.
- Users connect with their own Google account.
- Users pick a folder in a shared drive.
- CashGap creates or opens a Google Sheets workbook in that folder.
- Data is stored in these sheets:
  - `Settings`
  - `Projects`
  - `ManualIncome`
  - `Expenses`
  - `PlRows`

## Notes

- Access tokens are requested in the browser and are not stored on a separate backend.
- A workbook must be selected or created before saving.
- The saved workbook format is intentionally simple so it can be inspected directly in Google Sheets.
