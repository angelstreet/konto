import { describe, it, expect } from 'vitest';
import { accountBalanceEur, FIAT_CURRENCIES, netWorthEur } from '../../backend/src/money.ts';

// bank_accounts.balance is held in the account's OWN unit: euros for a French
// current account, CHF for a Swiss one, and a raw token quantity for crypto
// (250 million PEPE is stored as 250000000). Nothing may add those numbers
// together directly — every total goes through accountBalanceEur, because a
// token count summed as euros once produced a net worth in the billions.
//
// Figures here are invented. Never paste a real account balance into this
// repo: it is public.

const prices = { BTC: 90000, ETH: 3000, POL: 0.0821 };
const rates = { EUR: 1, USD: 1.08, CHF: 0.94 };

describe('accountBalanceEur', () => {
  it('leaves a euro balance alone', () => {
    expect(accountBalanceEur({ currency: 'EUR', balance: 1234.56 }, prices, rates)).toBeCloseTo(1234.56, 2);
  });

  it('treats a missing currency as euros', () => {
    expect(accountBalanceEur({ balance: 500 }, prices, rates)).toBe(500);
  });

  it('divides a foreign fiat balance by its per-euro rate', () => {
    // 940 CHF at 0.94 CHF per EUR = 1000 EUR
    expect(accountBalanceEur({ currency: 'CHF', balance: 940 }, prices, rates)).toBeCloseTo(1000, 6);
  });

  it('prices a crypto balance with the live rate', () => {
    expect(accountBalanceEur({ currency: 'BTC', balance: 0.5 }, prices, rates)).toBeCloseTo(45000, 6);
  });

  it('falls back to the provider EUR value when the token has no live price', () => {
    // PEPE is not quoted by the price feed; the provider already valued it.
    const pepe = { currency: 'PEPE', balance: 250000000, balance_native: 800 };
    expect(accountBalanceEur(pepe, prices, rates)).toBeCloseTo(800, 2);
  });

  it('never counts a token quantity as euros', () => {
    const pepe = { currency: 'PEPE', balance: 250000000, balance_native: 800 };
    expect(accountBalanceEur(pepe, prices, rates)).toBeLessThan(10000);
  });

  it('values an unknown token with no provider figure at zero rather than guessing', () => {
    expect(accountBalanceEur({ currency: 'XYZ', balance: 42000 }, prices, rates)).toBe(0);
  });

  it('handles a null balance', () => {
    expect(accountBalanceEur({ currency: 'EUR', balance: null }, prices, rates)).toBe(0);
  });

  it('keeps crypto out of the fiat set', () => {
    expect(FIAT_CURRENCIES.has('EUR')).toBe(true);
    expect(FIAT_CURRENCIES.has('CHF')).toBe(true);
    expect(FIAT_CURRENCIES.has('BTC')).toBe(false);
    expect(FIAT_CURRENCIES.has('PEPE')).toBe(false);
  });

  it('sums a mixed portfolio in euros, not in token counts', () => {
    const accounts = [
      { currency: 'EUR', balance: 10000, type: 'checking' },
      { currency: 'CHF', balance: 940, type: 'savings' },
      { currency: 'BTC', balance: 0.1, type: 'investment' },
      { currency: 'PEPE', balance: 250000000, balance_native: 800, type: 'investment' },
      { currency: 'SHIB', balance: 30000000, balance_native: 150, type: 'investment' },
    ];
    const total = accounts.reduce((s, a) => s + accountBalanceEur(a, prices, rates), 0);
    // 10000 + 1000 + 9000 + 800 + 150
    expect(total).toBeCloseTo(20950, 2);
    expect(total).toBeLessThan(1e6);
  });
});

// A portfolio shaped like the one that exposed both totals bugs: cash, an
// investment account whose positions are also listed in the investments table,
// and a property financed by a loan that is linked to it.
const PORTFOLIO = {
  accountsEur: 120000,   // all non-loan accounts, converted to EUR
  assetsGross: 400000,   // assets at gross value
  loansEur: -250000,     // loans, linked to an asset
};
const INVESTMENT_POSITIONS = 90000; // positions held inside the accounts above

describe('netWorthEur', () => {
  it('adds accounts and gross assets, then deducts the loans', () => {
    expect(netWorthEur(PORTFOLIO)).toBeCloseTo(270000, 2);
  });

  it('does not count investment positions on top of the accounts holding them', () => {
    // /api/v1/summary used to add them, inflating net worth by their full value.
    const doubleCounted = netWorthEur(PORTFOLIO) + INVESTMENT_POSITIONS;
    expect(netWorthEur(PORTFOLIO)).not.toBeCloseTo(doubleCounted, 2);
    expect(doubleCounted - netWorthEur(PORTFOLIO)).toBeCloseTo(INVESTMENT_POSITIONS, 2);
  });

  it('deducts each loan once, not once per place it appears', () => {
    // The dashboard used to add a net asset value (assets minus the linked
    // loans) to a net balance that had already deducted them, so every
    // asset-linked loan came off twice.
    const assetsNetOfLoans = PORTFOLIO.assetsGross + PORTFOLIO.loansEur;
    const doubleSubtracted = PORTFOLIO.accountsEur + PORTFOLIO.loansEur + assetsNetOfLoans;
    expect(doubleSubtracted).toBeCloseTo(20000, 2);
    expect(netWorthEur(PORTFOLIO) - doubleSubtracted).toBeCloseTo(-PORTFOLIO.loansEur, 2);
  });

  it('is the plain sum of its three parts', () => {
    expect(netWorthEur({ accountsEur: 1000, assetsGross: 500, loansEur: -200 })).toBe(1300);
  });

  it('handles a portfolio with no assets and no debt', () => {
    expect(netWorthEur({ accountsEur: 2500, assetsGross: 0, loansEur: 0 })).toBe(2500);
  });

  it('goes negative when the debt exceeds everything owned', () => {
    expect(netWorthEur({ accountsEur: 100, assetsGross: 0, loansEur: -5000 })).toBe(-4900);
  });
});
