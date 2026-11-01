import { describe, it, expect } from 'vitest';
import { accountBalanceEur, FIAT_CURRENCIES } from '../../backend/src/money.ts';

// bank_accounts.balance is held in the account's OWN unit: euros for a current
// account, CHF for a Swiss one, and a raw token quantity for crypto. Every total
// in the app must therefore go through accountBalanceEur. Summing raw balances
// once pushed patrimoine_net to 162 billion euros, because 179 million PEPE was
// added as 179 million euros.

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
    // PEPE is not quoted by the price feed; Coinbase already told us it is 800 EUR.
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
