# Konto — Money, Currencies and Totals

Every figure the app shows is money, and the same two mistakes have produced
absurd numbers twice. This document is the rule set. Read it before touching any
code that sums, converts or displays an amount.

**This repo is public. Never commit a real balance, account number or net worth
— not in code, not in a test fixture, not in a commit message. Use invented
figures; the tests care about relationships, not amounts.**

## The one rule

`bank_accounts.balance` is **not euros**. It is the amount in the account's own
unit:

| Account | `currency` | `balance` means |
|---|---|---|
| French current account | `EUR` | euros |
| Swiss account (Yuh, Axa PER) | `CHF` | Swiss francs |
| Bitcoin wallet | `BTC` | bitcoin |
| Coinbase meme-coin wallet | `PEPE`, `SHIB`, … | number of tokens |

So `SUM(balance)` is meaningless. Summing it adds token counts to euros: a
wallet holding 250 million PEPE (worth a few hundred euros) contributes 250
million to the total.

**Everything goes through `accountBalanceEur()` in [`backend/src/money.ts`](../backend/src/money.ts).**

```ts
accountBalanceEur(account, cryptoPrices, fiatRates)
```

In order:

1. `currency` is fiat (`FIAT_CURRENCIES`) → `balance / fiatRates[currency]`.
   Rates are *units per 1 EUR*, so CHF 0.94 means 1 EUR = 0.94 CHF.
2. The price feed quotes the token → `balance * cryptoPrices[currency]`.
3. Otherwise → `balance_native`, the EUR value the provider itself reported.
4. Otherwise → `0`. Undervaluing is recoverable; treating a token count as
   euros is not.

`money.ts` holds no database or network calls so it can be unit-tested directly
([`tests/api/money.test.ts`](../tests/api/money.test.ts)). The cached rate feeds
live in `shared.ts`, which re-exports the pure functions for existing callers.

## Net worth

One definition, `netWorthEur()` in the same file, called by `/api/dashboard`,
`/api/v1/summary` and the ClawBox integration summary so they cannot drift:

```
netWorthEur = accountsEur + assetsGross + loansEur
```

- `accountsEur` — every non-loan account, each via `accountBalanceEur`.
- `assetsGross` — assets at `current_value` (or `purchase_price` when unvalued).
- `loansEur` — loan account balances, which are **negative**.

Two things are deliberately not parameters, because passing them is how this
went wrong:

- **Investment positions are never added.** Rows in `investments` are the
  holdings *inside* an investment account whose balance is already counted.
  Every account that has positions has them sum to its own balance (checked
  against production: exact to the cent, bar one account a fraction of a percent
  off on valuation timing). Only a minority of investment accounts have position
  rows at all — crypto wallets and manual entries have none — so the account
  balance is the authoritative figure and positions are a breakdown of it.
- **Assets go in gross.** `loansEur` already carries every loan, whether or not
  it is linked to an asset. `patrimoine.netValue` (assets minus their linked
  loans) is a useful per-asset equity view and is still exposed, but adding it to
  a balance that has already deducted those loans subtracts them twice.

## Crypto prices

`CG_MAP` in `shared.ts` maps a currency code to a CoinGecko id, and only those
tokens get a live price; everything else relies on `balance_native`.

Watch the ids. POL must be `polygon-ecosystem-token`. `matic-network` is
*"MATIC (migrated to POL)"*, the pre-migration token, and trades well above POL
— using it overvalued the holding by about 37%.

Prices are cached 5 minutes in memory and in `kv_cache` (so Vercel cold starts
have a value). Fiat rates come from the ECB via Frankfurter, cached 12 hours,
with a static fallback table. XOF is pegged and never quoted.

## `balance_native`

The EUR value a provider reported for a holding. It is the fallback for tokens
the price feed does not quote.

- Added by migration in `db.ts`. Production had it added by hand, so fresh
  databases were missing the column entirely for a long time.
- The Coinbase sync fills it from the portfolio breakdown, which reports one
  fiat value per **asset**, covering every wallet that holds it — a plain "POL"
  wallet and a "Staked POL" one share a single spot position. That value is
  apportioned by each wallet's share of the asset's total quantity
  (`apportionAssetFiat` in `routes/crypto.ts`). It used to be assigned whole to
  each wallet, which would have double-counted any unpriced token held in two
  places.
- `updateCryptoBalanceNative()` recomputes it as `balance * price` for tokens
  that have a price. It writes only `balance_native`.

## Never rewrite `balance` from a price

`balance` is set from a provider's report — Powens, Coinbase, Binance, an
on-chain RPC, or the user typing it. Converting it is a **read-time** concern.

A "one-time fix" migration once divided every crypto balance above 100 by its
live EUR price to undo an older bug. `migrateDatabase()` runs on every boot, and
on Vercel that means every cold start, so it re-applied itself indefinitely:
each run multiplied the balance by `1/price`, and one account compounded to
around 1e28 tokens before it was found. The growth tracked `(1/price)^n` exactly
across consecutive reads.

If a data repair is ever needed again:

- do it as a script run once, not in `migrateDatabase()`;
- or guard it with a persisted "applied" flag;
- and prefer re-syncing from the provider, which is authoritative — for Coinbase
  that is `POST /api/coinbase/sync`, which overwrites `balance` and
  `balance_native` for every wallet.

## Gotcha: the API response cache

`backend/src/index.ts` keeps a **60-second in-memory GET cache per user+URL**
covering `/api/dashboard`, `/api/bank/accounts`, `/api/investments`,
`/api/transactions`, `/api/analytics`, `/api/loans`, `/api/assets` and others
(`CACHED_PREFIXES`). Writes (`POST`/`PUT`/`PATCH`/`DELETE`) invalidate that
user's entries.

When checking a change by hand, a stale read looks exactly like a broken
endpoint — zeros, or the old number. Add a cache-busting query parameter:

```bash
curl "$URL/api/dashboard?cb=$(date +%s)"
```

`/api/v1/*` is **not** cached, which is why it can disagree with
`/api/dashboard` for up to a minute after a change.

## Gotcha: a loan's instalment count is not trustworthy

`loan_details.installments_paid`, `installments_left` and `duration_months`
come from two sources that disagree — what Powens reports and what
`parse-loan-pdf` read off the amortisation table — and neither is reconciled
against the balance. One loan reports **53 instalments paid on a term that
started 18 months ago**; another reports 282 left where the balance, rate and
instalment imply 259.

Three fields *are* mutually consistent, and reproduce the stored
`monthly_breakdown` to the cent:

- `bank_accounts.balance` (negative; the capital still owed)
- `loan_details.interest_rate`
- `loan_details.monthly_payment` — **insurance included**, so the amortising
  part is `monthly_payment - insurance_monthly`

So project a schedule forward from those, month by month:

```
interest = balance × rate / 12 / 100
capital  = (monthly_payment − insurance_monthly) − interest
balance  = balance − capital
```

`frontend/src/lib/propertyArbitrage.ts` (`projectLoan`, `payoffMonths`) does
exactly this, and the payoff date it derives lands within a few months of
`end_date` — whereas `installments_left` does not. Never compute a remaining
balance at a future date from the instalment counts.

An instalment too small to cover the interest never amortises: guard for it
rather than looping forever.
