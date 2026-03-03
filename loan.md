# Loans Feature Spec (`loan.md`)

## Goal
Implement a complete `Emprunts` experience in Konto (desktop + mobile) aligned with provided reference screens.

Current state in repo:
- `frontend/src/pages/LoansDashboard.tsx` exists but is placeholder-only.
- It is not wired in routes/navigation.
- Backend has minimal `GET /api/v1/loans` returning only `name` and `remaining_amount` from loan accounts.

This document defines scope, data, UI behavior, and implementation order.

## Product Scope

### Core user outcomes
1. View all loans with current remaining principal and repayment progress.
2. Open one loan and see detailed repayment/synthesis metrics.
3. See loan distribution and portfolio-level debt analytics.
4. View linked assets for each loan.
5. Add/edit loans (manual mode for missing provider data).

### Platforms
- Desktop: dashboard-first + passifs table/list + loan detail.
- Mobile: card list first, then tabbed loan detail (`Synthèse`, `Mensualité`, `Apprendre`, `Actifs liés`).

## Information Architecture

### Routes
1. `/loans`
- Loans overview page.

2. `/loans/:loanId`
- Loan detail page.

### Navigation integration
1. Sidebar
- Add `Emprunts` entry under `Patrimoine` group.

2. More page (mobile)
- Add `Emprunts` item under `Patrimoine` section.

3. BottomNav
- Keep current structure (no direct tab required).
- `morePaths` should include `/loans` and `/loans/:id` so `More` remains active when inside loans.

## Desktop UX Requirements

### A. Overview (`/loans`)
1. Header
- Title: `Emprunts`
- Total outstanding amount (sum of remaining principal).
- Date label (today).
- CTA: `+ Ajouter un prêt`

2. Main row
- Left: portfolio remaining-capital chart over time.
- Right: distribution treemap by loan (remaining principal + share %).
- Filter select: `Tous les emprunts` (future-ready for bank/type filter).

3. Analysis cards
- Mensualité (split capital/intérêts/assurance with donut)
- Durée moyenne
- Taux moyen
- Capacité disponible (placeholder allowed if no data)

4. Passifs list/table
Columns:
- Nom
- Total remboursé (%)
- Taux d’intérêt
- Mensualité
- Capital restant dû
- Kebab actions

Behavior:
- Row click opens `/loans/:loanId`
- Sort by remaining principal desc by default

### B. Detail (`/loans/:loanId`)
1. Header
- Loan name + provider badge/icon if available
- Remaining principal (big)

2. Content
- Left: loan payoff chart (single-loan curve)
- Right KPI card:
  - Mensualité split (capital/intérêts/assurance)
  - Échéances payées
  - Échéances restantes
  - Date de fin
  - Progress statement (`Vous avez remboursé X %`)

3. Synthesis cards
- Coût total de l’emprunt
- Total remboursé
- Capital restant dû

4. Linked assets section
- List related assets linked through `assets.linked_loan_account_id`
- Item click navigates to corresponding asset detail/edit flow

## Mobile UX Requirements

### A. List screen (`/loans`)
1. Header with total outstanding.
2. Tabs: `Emprunts` / `Apprendre`.
3. Vertical loan cards:
- Name
- Remaining amount
- Progress text + horizontal progress bar
4. FAB `+` for add loan.

### B. Detail screen (`/loans/:loanId`)
1. Sticky tab row:
- `Synthèse`
- `Mensualité`
- `Apprendre`
- `Actifs liés`

2. Tab content
- `Synthèse`: top KPI tiles + detailed breakdown card
- `Mensualité`: next payment composition + installment counts + end date
- `Actifs liés`: linked assets list with allocation amounts
- `Apprendre`: educational empty-state (MVP static content acceptable)

## Data Model and API Contract

## Existing data available
- Loan accounts: `bank_accounts` where `type = 'loan'`, `balance < 0` typically.
- Asset links: `assets.linked_loan_account_id`.

## Required API shape (target)

### 1) GET `/api/v1/loans`
Return portfolio-level data for overview.

```json
{
  "date": "2026-03-03",
  "total_outstanding": 774799,
  "currency": "EUR",
  "summary": {
    "monthly_total": 4080,
    "avg_duration_years": 25,
    "avg_rate": 1.86,
    "capacity_available": null
  },
  "distribution": [
    { "loan_id": 8, "name": "Prêt Tout Habitat", "remaining": 239778, "share_pct": 31 }
  ],
  "timeline": [
    { "year": 2026, "remaining": 780000 },
    { "year": 2027, "remaining": 739134 }
  ],
  "loans": [
    {
      "loan_id": 8,
      "name": "Prêt Immobilier",
      "provider": "CIC",
      "remaining": 412529,
      "monthly_payment": 2121,
      "interest_rate": 2.6,
      "repaid_pct": 13,
      "end_date": "2048-03-01"
    }
  ]
}
```

### 2) GET `/api/v1/loans/:loanId`
Return detail data for one loan.

```json
{
  "loan": {
    "loan_id": 8,
    "name": "Cic Immo Prêt Modulable Jnd Construction",
    "type_label": "Prêt amortissable",
    "remaining": 412529,
    "monthly_payment": 2121,
    "interest_rate": 2.6,
    "repaid_pct": 13,
    "installments_paid": 38,
    "installments_left": 263,
    "end_date": "2048-03-01"
  },
  "monthly_breakdown": {
    "capital": 1165,
    "interest": 956,
    "insurance": 0
  },
  "totals": {
    "loan_cost": 638568,
    "capital_total": 455000,
    "interest_insurance_total": 183568,
    "fees_total": 0,
    "repaid_total": 80617,
    "repaid_capital": 42471,
    "repaid_interest": 38145,
    "repaid_insurance": 0,
    "remaining_total": 412529,
    "remaining_to_repay": 557952,
    "remaining_pct": 87
  },
  "timeline": [
    { "year": 2026, "remaining": 412529 },
    { "year": 2047, "remaining": 0 }
  ],
  "linked_assets": [
    {
      "asset_id": 101,
      "name": "6 imp. Fabygil, 13180 Gignac-la-Nerthe, France",
      "usage": "Résidence principale",
      "allocation_pct": 100,
      "allocation_amount": 455000
    }
  ]
}
```

### Data fallback rules (MVP)
- If schedule-level data is unavailable from provider, compute and/or default safely:
  - `monthly_payment`, `interest_rate`, `end_date`: nullable.
  - `repaid_pct`: infer from historical snapshots if available, else `null`.
  - Show `Pas de données` UI chips where null.
- Never block page rendering when fields are missing.

## Backend Implementation Notes

1. Keep current `/api/v1/loans` backward compatible while extending response.
2. Add `/api/v1/loans/:loanId` route.
3. Use `assets.linked_loan_account_id` join for linked assets.
4. If historical debt curve missing, derive synthetic yearly interpolation for MVP.
5. Ensure demo/sandbox mode returns stable mock loans data matching front contract.

## Frontend Implementation Notes

1. Replace placeholder `frontend/src/pages/LoansDashboard.tsx` with real container component.
2. Add new `frontend/src/pages/LoanDetail.tsx`.
3. Add API client helpers in existing API layer (`frontend/src/lib/api.ts` or equivalent existing module).
4. Add responsive layout:
- Desktop: chart + treemap two-column.
- Mobile: cards and tabbed detail.
5. Remove `alert()` CTA, replace with modal/sheet-based add flow (or navigate to form route).
6. Add i18n keys in `frontend/src/i18n/fr.json` and `frontend/src/i18n/en.json`.

## i18n Keys (minimum)
- `nav_loans`
- `loans_title`
- `loan_add`
- `loans_distribution`
- `loans_analysis`
- `loan_monthly`
- `loan_avg_duration`
- `loan_avg_rate`
- `loan_capacity_available`
- `loan_total_repaid`
- `loan_remaining_principal`
- `loan_tabs_summary`
- `loan_tabs_monthly`
- `loan_tabs_learn`
- `loan_tabs_linked_assets`
- `loan_no_data`

## Testing Requirements

### Unit/integration
1. API parsing and fallback handling for nullable fields.
2. Calculation helpers:
- weighted average rate
- repaid percentage
- totals consistency

### UI/e2e (critical)
1. `/loans` renders with mixed complete/incomplete loan data.
2. Row/card click navigates to `/loans/:loanId`.
3. Mobile detail tabs switch correctly.
4. Linked assets section displays and navigates.
5. No crash in demo mode.

## Rollout Plan

### Phase 1 (MVP ship)
1. Route + nav wiring.
2. Loans overview with real account data.
3. Loan detail basic page.
4. Mobile card list + detail tabs.
5. i18n coverage and no-placeholder UX.

### Phase 2
1. Real amortization schedule integration.
2. Capacity available computation.
3. Learn tab rich content.
4. Add/Edit/Delete loan form and persistence.

### Phase 3
1. Advanced filtering and export.
2. Notifications for milestones (e.g., 50% repaid).

## Definition of Done
1. Loans pages are reachable from navigation on desktop/mobile.
2. No placeholder alert-based actions remain.
3. Overview and detail match screenshot structure.
4. Works with partial provider data without crashes.
5. Automated tests cover key workflows.
