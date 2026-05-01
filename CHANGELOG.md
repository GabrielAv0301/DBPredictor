# Changelog

All notable changes to the "queryguard" extension will be documented in this file.

## [1.2.0] - 2026-05-01

### Added

- Export history to CSV/JSON (via Clipboard).
- Improved Blast Radius visualization with detailed bar charts.
- Enhanced cascade tree navigation and styling.
- New "History" tab for better session tracking.

### Fixed

- Safety transaction logic for `ROLLBACK` during simulations.
- UI state persistence when switching between Analysis and History.

## [1.1.2] - 2026-04-17

### Fixed

- Fixed navigation issue in the History tab where background updates would force users back to the Analysis tab.
- Corrected Webview UI state management to allow stable history browsing.

## [1.1.1] - 2026-04-15

### Added

- Initial release of QueryGuard.
- Support for Prisma, Supabase, and Drizzle.
- Real-time row impact estimation.
- Recursive cascade deletion analysis.
- Safe simulation environment.
- Visual Blast Radius chart in Webview.
