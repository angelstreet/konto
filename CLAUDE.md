# Konto Development Guide

## Screenshots Reference
Reference screenshots (Finary UI) are stored at `/home/jndoye/shared/screenshot/` on the dev machine.
Use these to guide UI implementation for Patrimoine sections. Screenshot filenames are timestamped
`Screenshot 2026-02-17 at HH.MM.SS.png`.

Key screenshots by section:
- `20.03.54` – Finary Patrimoine overview (sidebar structure, all sections visible)
- `20.04.06` / `20.04.15` – Immobilier detail page
- `20.04.38` / `20.04.49` – Crypto detail page (wallets: Ledger Bitcoin, Coinbase, etc.)
- `20.04.59` / `20.05.13` – Comptes bancaires (chart + distribution + accounts list + transactions tab)
- `20.05.31` / `20.05.40` / `20.05.53` – Actions & Fonds (chart, scanner frais, diversification, dividendes, actifs table)
- `20.06.02` – Autres actifs (car: Mercedes class A AMG, 30 000 €)
- `20.06.10` – Fonds euros (distribution chart, CIC accounts)
- `20.06.17` / `20.06.30` – Emprunts (amortization chart, distribution, analyse: mensualité/durée/taux, passifs table)

## Patrimoine Sections (Finary reference)
Sidebar order: Immobilier → Crypto → Comptes bancaires → Actions & Fonds → Autres actifs → Fonds euros → Emprunts

## Project Structure
- Frontend root: `frontend/src/`
  - Pages: `frontend/src/pages/`
  - Components: `frontend/src/components/`
  - App routes: `frontend/src/App.tsx`
  - Sidebar nav: `frontend/src/components/Sidebar.tsx`
  - Translations: `frontend/src/i18n/fr.json`
- Backend API: `api/` (Express/Node)
- Tests: `tests/api/`
