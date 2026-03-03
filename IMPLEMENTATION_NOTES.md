# CashGap Implementation Notes

## Addressed requests

- Renamed the tool to `CashGap`.
- Converted the uploaded standalone JSX idea into a Vite + React project.
- Fixed the PL / BS fragment import issue.
- Fixed the BS year-end cash bug for the exact `0` case.
- Replaced row-order-dependent non-operating income / expense logic with explicit `subtype` fields.
- Made the app fiscal-year based by applying `fiscalYearStart` to all month labels and yearly flows.
- Added delete buttons for:
  - manual income rows
  - expense rows
  - PL rows
- Removed unused settings from the UI to keep the interface simpler.
- Added Google Drive / Google Sheets persistence.
- Added a shared-drive folder picker flow for choosing the save location.

## Storage design

The app stores editable data in a Google Sheets workbook using these tabs:

- `Settings`
- `Projects`
- `ManualIncome`
- `Expenses`
- `PlRows`

## Important setup note

To run Google integration, the app needs:

- Google OAuth client ID
- Google API key
- Google Cloud project number
- Enabled APIs:
  - Google Drive API
  - Google Sheets API
  - Google Picker API
