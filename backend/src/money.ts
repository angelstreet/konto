/**
 * Currency conversion — pure, no database, no network.
 *
 * `bank_accounts.balance` is held in the account's OWN unit: euros for a French
 * current account, CHF for a Swiss one, and a raw token quantity for crypto
 * (179 million PEPE is stored as 250000000). Nothing may add those numbers
 * together directly — every total in the app goes through accountBalanceEur.
 *
 * The live rate feeds live in shared.ts because they cache through the DB; this
 * module holds the arithmetic so it can be unit-tested on its own.
 */

/**
 * Units of each currency per 1 EUR. Used when the live feed is unavailable.
 * XOF is pegged to the euro at a fixed parity and is never quoted by the ECB.
 */
export const FIAT_EUR_FALLBACK: Record<string, number> = {
  EUR: 1, USD: 1.08, GBP: 0.86, CHF: 0.94, CAD: 1.47, JPY: 162, XOF: 655.957,
};

/** Currencies treated as fiat; anything else is looked up as a crypto asset. */
export const FIAT_CURRENCIES = new Set(Object.keys(FIAT_EUR_FALLBACK));

/**
 * A bank account's balance converted to EUR — the single source of truth for
 * every total in the app.
 *
 * Fiat balances are divided by their per-EUR rate. Crypto balances are priced
 * live where the feed quotes the token, and otherwise fall back to the EUR value
 * the provider itself reported (balance_native). A token we can neither price
 * nor read a provider value for counts as 0: undervaluing is recoverable,
 * whereas treating a token count as euros is what produced a 162-billion-euro
 * net worth.
 */
export function accountBalanceEur(
  account: any,
  cryptoPrices: Record<string, number>,
  fiatRates: Record<string, number>,
): number {
  const cur = account.currency || 'EUR';
  const balance = account.balance || 0;

  if (FIAT_CURRENCIES.has(cur)) {
    const rate = fiatRates[cur];
    return rate && rate > 0 ? balance / rate : balance;
  }
  if (cryptoPrices[cur]) return balance * cryptoPrices[cur];
  if (account.balance_native != null && account.balance_native !== 0) return account.balance_native;
  return 0;
}

/** The three pieces net worth is built from, each already converted to EUR. */
export type NetWorthParts = {
  /** Every non-loan account balance, via accountBalanceEur. */
  accountsEur: number;
  /** Assets at gross value — current_value, or purchase_price when unvalued. */
  assetsGross: number;
  /** Loan account balances, which are negative. */
  loansEur: number;
};

/**
 * Net worth. One definition, shared by the dashboard, the public API summary and
 * the ClawBox integration, so those three cannot drift apart again.
 *
 * Two things are deliberately NOT parameters, because passing them is how this
 * figure went wrong twice:
 *
 * - Investment positions (the `investments` table). They are a breakdown of the
 *   investment accounts already inside accountsEur; in production each such
 *   account's positions sum to its own balance to the cent. Adding them counted
 *   192 889 EUR twice.
 * - Loans net of assets. assetsGross is gross on purpose: loansEur already
 *   carries every loan, asset-linked or not. Subtracting the linked ones again
 *   via a "net asset value" understated net worth by 775 416 EUR.
 */
export function netWorthEur({ accountsEur, assetsGross, loansEur }: NetWorthParts): number {
  return accountsEur + assetsGross + loansEur;
}
