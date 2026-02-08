# TAX-SPEC.md — French Tax System Technical Specification for Kompta

> What Kompta needs to compute for each declaration type to replace an accountant.

---

## Table of Contents

1. [Corporate Tax (IS) — By Company Type](#1-corporate-tax-is--by-company-type)
2. [Personal Income Tax (IR)](#2-personal-income-tax-ir)
3. [TVA (VAT)](#3-tva-vat)
4. [Data Requirements](#4-data-requirements)
5. [Automation vs Accountant Review](#5-automation-vs-accountant-review)
6. [Calendar of Obligations](#6-calendar-of-obligations)

---

## 1. Corporate Tax (IS) — By Company Type

All four structures below are subject to **Impôt sur les Sociétés (IS)**.

### 1.1 SASU (Société par Actions Simplifiée Unipersonnelle)

**Jo's current structure.**

#### Required Annual Declarations (Liasse Fiscale)

| Formulaire | Name | Content |
|---|---|---|
| **2065** | Déclaration de résultat IS | Main IS return — CA, charges, résultat fiscal |
| **2065-bis** | Annexe | Breakdown of remunerations, distributions |
| **2033-A** | Compte de résultat simplifié | P&L (régime simplifié if CA < 840k€ services) |
| **2033-B** | Bilan simplifié — Actif | Balance sheet assets |
| **2033-C** | Bilan simplifié — Passif | Balance sheet liabilities |
| **2033-D** | Relevé des provisions, amortissements | Depreciation & provisions |
| **2033-E** | Détermination de la valeur ajoutée | CVAE calculation (if applicable) |
| **2033-F** | Composition du capital social | Shareholding structure |
| **2033-G** | Filiales et participations | Subsidiaries (if any) |
| **DAS2** | Déclaration d'honoraires | Fees > 1,200€ paid to third parties |

*Note: If CA > 840k€ (services) or > 254k€ (vente), use régime réel normal → forms 2050–2059.*

#### Key Calculations

```
Chiffre d'affaires (CA) = Σ invoices (HT)
Charges déductibles = salaries + social charges + rent + subscriptions + supplies + depreciation + ...
Résultat fiscal = CA - Charges déductibles (+/- reintégrations/déductions extra-comptables)

IS calculation (2025 rates):
  - 15% on first 42,500€ (if CA < 10M€ and capital fully paid by individuals)
  - 25% on remainder

IS payable = IS calculated - acomptes already paid (4 quarterly installments)
```

#### Acomptes IS (Quarterly Prepayments)
- **4 installments**: 15 March, 15 June, 15 September, 15 December
- Each = 25% of prior year IS
- Regularization with annual return (2nd business day after 1 May for calendar year)

#### Social Declarations (Payroll)
- **DSN** (Déclaration Sociale Nominative): monthly, by 5th or 15th — payroll data to URSSAF/retirement/etc.
- **Bulletin de paie**: monthly salary slip for président(e)
- Charges sociales: ~75-80% of net salary for assimilé-salarié (président SASU)

---

### 1.2 SAS (Société par Actions Simplifiée)

**Identical to SASU** for tax purposes. Same forms, same IS regime.

Differences are purely governance (multiple shareholders, board possible):
- 2033-F must list all shareholders
- DAS2 may have more entries
- Conventions réglementées reporting if related-party transactions

---

### 1.3 SCI (Société Civile Immobilière)

**SCI à l'IS** — taxed at corporate level (not transparent).

#### Required Declarations

| Formulaire | Content |
|---|---|
| **2065 + 2065-bis** | IS return (same as SASU) |
| **2033-A to G** | Liasse fiscale simplifiée (same set) |
| **2072** | NOT required if IS-option elected (2072 is for SCI à l'IR only) |

#### Key Calculations

```
Revenus fonciers = Σ rental income (loyers HT if TVA-option)
Charges déductibles = loan interest + insurance + property tax (taxe foncière)
                    + management fees + repairs + depreciation (building only, not land)
Résultat = Revenus - Charges
IS = same rates as SASU (15%/25%)
```

#### SCI-Specific Points
- **Depreciation of buildings** is allowed under IS (not under IR) — major advantage
- Land is NOT depreciable (typically 15-20% of acquisition = land)
- Amortissement = (Building value) / useful life (20-50 years typically)
- **Plus-values**: taxed as professional capital gains (short-term/long-term regime), NOT the private regime with abatements
- Deficit can offset future SCI profits (no limit)

---

### 1.4 Holding Company (typically SAS or SASU holding)

**Same forms as SAS/SASU** plus specific regimes:

#### Régime Mère-Fille (Parent-Subsidiary)
- Condition: holds ≥5% of subsidiary for ≥2 years
- Dividends received from subsidiaries: **95% exempt** (only 5% quote-part de frais et charges taxed)
- Must elect on form 2058-A (case ZA)

#### Integration Fiscale (Tax Consolidation)
- Condition: holds ≥95% of subsidiaries
- One consolidated IS return (2058) for the group
- Losses of one subsidiary offset profits of another
- Forms: 2058-A bis, 2058-B bis, 2058-ER, 2058-ES

#### Key Calculations for Holding

```
Revenue = management fees from subsidiaries + dividends received
Dividends (mère-fille): taxable portion = 5% of dividends received
Charges = holding costs (management, accounting, legal)
Résultat fiscal = Revenue - Charges + reintégrations

If integration fiscale:
  Consolidated result = Σ individual results + neutralizations
  Group IS on consolidated result
```

---

## 2. Personal Income Tax (IR)

Based on Jo's 2023 avis d'imposition.

### 2.1 Salary from SASU → IR

```
Flow: SASU pays gross salary → DSN declares to URSSAF → Net imposable on payslip

On IR declaration (2042):
  Case 1AJ: Salaires = 32,510€ (Jo 2023)
  Deduction: 10% forfaitaire = 3,251€ (or frais réels if higher)
  Net imposable salaires = 29,259€
```

**What Kompta needs:**
- Monthly payslip data → annual total in 1AJ
- Track frais réels option vs 10% deduction (compare annually)
- Prélèvement à la source (PAS) already withheld by SASU → reported in DSN

### 2.2 Revenus Fonciers (SCI à l'IR or direct ownership)

*Note: If SCI is at IS, rental income stays in SCI and doesn't flow to IR directly. Only dividends from SCI→IR.*

For SCI à l'IR or direct ownership:
```
Micro-foncier (if revenus fonciers bruts < 15,000€):
  Case 4BE: Gross rental income
  Automatic 30% abatement
  
Régime réel (form 2044):
  Revenus bruts - charges déductibles = revenu foncier net
  Cases 4BA (profit) or 4BB/4BC (deficit)
  Deficit imputable on global income: max 10,700€/year
```

### 2.3 LMNP (Locations Meublées Non Professionnelles)

From Jo's avis: 156€ declared, with prior deficits carried forward.

```
Micro-BIC (if LMNP revenue < 77,700€):
  Case 5ND: Gross revenue
  50% automatic abatement

Régime réel (form 2031 + 2033):
  Revenue - charges - amortissement = résultat BIC
  LMNP deficit can ONLY offset future LMNP income (not global income)
  Carry forward: 10 years
  Cases 5NA (profit) / 5NY (deficit)

Jo 2023 situation:
  Revenue declared: 156€
  Deficit from 2022 carried forward: 36,075€
  Deficit from 2023: 156€ (likely net zero or small deficit after amortissement)
  → All carried to 2024+ declarations
```

**What Kompta needs:**
- Track LMNP revenues per property
- Calculate amortissement (property, furniture, works)
- Maintain deficit carry-forward register (per year, 10-year expiry)
- Generate form 2031 + liasse if régime réel

### 2.4 PFU on Dividends / Capital Gains (RCM)

From Jo's avis: RCM = 36,075€, PFU at 12.8%.

```
Prélèvement Forfaitaire Unique (PFU / "flat tax"):
  12.8% IR + 17.2% prélèvements sociaux = 30% total

Already withheld at source by bank/broker (PFU non libératoire → declared on 2042):
  Case 2DC: Dividends received
  Case 2CG: Plus-values
  Case 2CK: PFU already paid (crédit d'impôt)

Option barème progressif (case 2OP):
  Can opt to tax all RCM at progressive rates instead of flat 12.8%
  → Advantageous if marginal rate < 12.8% (i.e., TMI ≤ 11%)
  → Also unlocks 40% abatement on dividends (case 2DC → 60% taxed)
  → Also unlocks CSG deductible (6.8% of RCM)

Jo 2023: TMI = 11%, so barème option MIGHT be better
  With barème: 36,075 × 60% × 11% = ~2,381€ (vs PFU: 36,075 × 12.8% = 4,618€)
  → Barème is clearly better for Jo! Kompta should flag this optimization.
```

**What Kompta needs:**
- Import RCM data (IFU form from banks/brokers)
- Compare PFU vs barème progressif annually → recommend optimal choice
- Track CSG déductible (case 2BH) if barème chosen

### 2.5 CSG / CRDS

```
Prélèvements sociaux on investment income:
  CSG: 9.2% (of which 6.8% deductible if barème option)
  CRDS: 0.5%
  Prélèvement de solidarité: 7.5%
  Total: 17.2%

On salaries: already included in social charges (handled by DSN/payroll)
On RCM: withheld at source or declared
On rental income (foncier): computed by tax administration on IR assessment
```

### 2.6 Prélèvement à la Source (PAS) Reconciliation

```
During year N:
  Employer withholds PAS on salary monthly (rate from prior year assessment)
  Bank withholds PFU on investment income

At IR declaration (N+1):
  Total tax computed on all income
  - PAS already withheld (salary) → case 8HV
  - PFU already withheld (RCM) → case 2CK
  - Acomptes contemporains (foncier, BIC) → case 8HW
  = Solde (remaining to pay or refund)

Jo 2023:
  IR due: 1,095€
  PAS withheld by employer: 2,936€
  Solde: -1,841€ → refund
```

**What Kompta needs:**
- Track all PAS withholdings through the year
- Estimate year-end position to recommend rate modulation
- Flag if underpayment likely (avoid penalties)

---

## 3. TVA (VAT)

### Regimes by CA Threshold (Services)

| Regime | CA Threshold | Declaration | Payment |
|---|---|---|---|
| **Franchise de base** | < 36,800€ | None | None (no TVA collected) |
| **Réel simplifié** | 36,800€ – 254,000€ | Annual (CA12) + 2 acomptes | July + December acomptes |
| **Réel normal** | > 254,000€ | Monthly (CA3) | Monthly |

*For sale of goods: thresholds are 91,900€ and 840,000€.*

### Key TVA Calculations

```
TVA collectée = Σ (invoice amount HT × TVA rate)
TVA déductible = Σ (purchase amount HT × TVA rate) [on valid invoices]
TVA due = TVA collectée - TVA déductible

If TVA déductible > TVA collectée → credit de TVA (can request refund or carry forward)

Standard rate: 20%
Intermediate: 10% (renovation works, restaurants)
Reduced: 5.5% (food, books, energy)
Super-reduced: 2.1% (press, medicine)
```

### TVA on SCI
- Residential rental: **exempt** (no TVA)
- Commercial/professional rental: option for TVA possible
- If TVA option: can deduct TVA on construction/renovation

### Forms

| Form | Frequency | Content |
|---|---|---|
| **CA3** | Monthly/Quarterly | TVA collected, deductible, due |
| **CA12** | Annual | Same, annual summary (régime simplifié) |
| **3519** | On demand | TVA credit refund request |

---

## 4. Data Requirements

### From Bank Transactions

| Data Point | Used For |
|---|---|
| Date, amount, label | All — base accounting entry |
| Counterparty | Categorization, DAS2 |
| Category (auto-classified) | P&L line items, TVA |
| Bank account (pro vs perso) | Scope filtering |

### From Invoices (Sales)

| Data Point | Used For |
|---|---|
| Client name + SIREN | DAS2, revenue recognition |
| Amount HT | CA calculation |
| TVA rate + amount | TVA declarations |
| Invoice date + payment date | CA12 timing, cash vs accrual |
| Invoice number | Sequential numbering compliance |

### From Invoices (Purchases)

| Data Point | Used For |
|---|---|
| Supplier name + SIREN | Charges, DAS2 |
| Amount HT + TVA | Charges, TVA déductible |
| Category | P&L classification |
| Date | Period matching |

### From Payroll

| Data Point | Used For |
|---|---|
| Gross salary | Charges, IS deduction |
| Net imposable | IR declaration (1AJ) |
| Social charges detail | DSN, accounting |
| PAS withheld | PAS reconciliation |

### From Investment Accounts (IFU)

| Data Point | Used For |
|---|---|
| Dividends received | IR case 2DC |
| Interest received | IR case 2TR |
| Capital gains | IR case 2CG |
| PFU already paid | IR case 2CK |
| CSG déductible | IR case 2BH |

### From Property (LMNP / SCI)

| Data Point | Used For |
|---|---|
| Rental income per property | Revenue |
| Loan interest | Charges déductibles |
| Property tax (taxe foncière) | Charges |
| Insurance premiums | Charges |
| Works / repairs | Charges or amortissement |
| Acquisition cost (land vs building split) | Amortissement calculation |
| Furniture inventory + values | Amortissement (LMNP) |

---

## 5. Automation vs Accountant Review

### Fully Automatable by Kompta ✅

| Task | How |
|---|---|
| Bank transaction categorization | ML classification + rules |
| TVA calculation (collectée/déductible) | From categorized transactions + invoices |
| CA3 / CA12 generation | Sum TVA by period |
| P&L generation | Categorized transactions → accounting entries |
| IS calculation | Apply rates to résultat fiscal |
| IS acomptes calculation | 25% of prior year IS |
| PAS tracking + projection | Aggregate withholdings, project year-end |
| LMNP amortissement schedule | Straight-line depreciation tables |
| LMNP deficit carry-forward register | Track per-year, 10-year expiry |
| PFU vs barème comparison | Simulate both, recommend |
| DAS2 generation | Flag payments > 1,200€ to same provider |
| Dashboard: estimated tax position | Real-time projection |

### Semi-Automatable (Kompta generates, human validates) ⚠️

| Task | Why Human Needed |
|---|---|
| Liasse fiscale (2033-A to G) | Some line items need judgment (provisions, accruals) |
| Balance sheet | Opening balances, inventory valuation |
| Reintégrations extra-comptables | Tax adjustments (e.g., luxury vehicle depreciation cap, non-deductible fines) |
| SCI land/building split | Valuation judgment on acquisition |
| Integration fiscale neutralizations | Complex inter-company eliminations |
| Form 2042 (IR) pre-fill verification | Cross-check with impots.gouv pre-filled data |

### Requires Accountant / Expert 🔴

| Task | Why |
|---|---|
| Commissaire aux comptes report | Legal requirement (SAS > thresholds) |
| Transfer pricing documentation | Holding ↔ subsidiary pricing |
| Tax optimization strategy | Requires holistic view + legal advice |
| Contrôle fiscal response | Legal representation |
| First-year opening balance sheet | Valuation of contributed assets |
| Option IS/IR election for SCI | Irreversible choice, needs advice |

---

## 6. Calendar of Obligations

### Monthly

| Day | Task | Entity |
|---|---|---|
| 5th or 15th | DSN (payroll declaration) | SASU/SAS with employees |
| ~19th | CA3 (TVA monthly) | If réel normal |
| ~15th | PAS reverse (acomptes for foncier/BIC) | Personal |

### Quarterly

| Date | Task |
|---|---|
| 15 Mar, 15 Jun, 15 Sep, 15 Dec | IS acomptes (each = 25% of prior year IS) |
| Jul + Dec | TVA acomptes (if réel simplifié) |

### Annual

| Deadline | Task | Form |
|---|---|---|
| 2nd business day after 1 May | Liasse fiscale IS + IS return | 2065 + 2033 |
| Same | DAS2 | DAS2 |
| May (CA12 deadline) | TVA annual return (simplifié) | CA12 |
| May–June | IR declaration | 2042 + annexes |
| May | LMNP return (if réel) | 2031 + 2033 |
| 15 May | Solde IS (or refund request) | 2572 |

---

## Appendix: Jo's 2023 Tax Profile (Reference)

```
PERSONAL (IR 2023):
  Foyer fiscal: 1 part + 0.5 (enfant?) = 1.5 parts
  Salaires (1AJ): 32,510€
  Net après 10%: 29,259€
  LMNP déclaré: 156€ (deficit carry-forward: 36,075€ from 2022)
  RCM (PFU): 36,075€ at 12.8%
  Revenu fiscal de référence: 29,280€
  IR net: 1,095€
  PAS withheld: 2,936€
  Refund: 1,841€
  Taux moyen: 3.75%
  TMI: 11%
  Epargne retraite plafond: 13,006€ (décl. 1) / 8,513€ (enfant)

OPTIMIZATION NOTE:
  Jo should verify barème option (2OP) vs PFU on RCM.
  At TMI 11% with 40% dividend abatement, barème is likely cheaper.
  Kompta must simulate both each year and flag recommendation.
```

---

*Generated by Mew for Kompta project — 2026-02-08*
