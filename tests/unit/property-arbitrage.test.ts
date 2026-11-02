import { describe, expect, test } from 'vitest';
import {
  projectLoan, payoffMonths, abatementIR, abatementPS, highGainSurtax,
  capitalGainsTax, earlyRepaymentPenalty, simulate, yearsHeld,
  type ArbitrageProperty, type ArbitrageInputs, type ArbitrageLoan,
} from '../../frontend/src/lib/propertyArbitrage';

// Invented figures throughout — the assertions check relationships, not amounts.
const LOAN: ArbitrageLoan = { balance: 100_000, rate: 2.4, payment: 620, insurance: 20 };

const PROPERTY: ArbitrageProperty = {
  value: 200_000,
  purchasePrice: 150_000,
  notaryFees: 12_000,
  works: 0,
  purchaseDate: '2010-01-01',
  isPrimaryResidence: false,
  loan: LOAN,
};

const INPUTS: ArbitrageInputs = {
  sellMonths: 0, rate: 6, growth: 1.5, horizonYears: 10,
  annualCost: 4_000, annualRent: 10_000, sellingCosts: 8_000, taxPlacement: true,
};

const TODAY = new Date('2030-01-01');

describe('projectLoan', () => {
  test('first instalment splits into the stored interest and capital', () => {
    const one = projectLoan(LOAN, 1);
    const expectedInterest = LOAN.balance * (LOAN.rate / 100 / 12);
    expect(one.interest).toBeCloseTo(expectedInterest, 6);
    expect(one.balance).toBeCloseTo(LOAN.balance - (LOAN.payment - LOAN.insurance - expectedInterest), 6);
    expect(one.paid).toBeCloseTo(LOAN.payment, 6);
  });

  test('balance only falls, and never below zero', () => {
    let previous = LOAN.balance;
    for (let m = 1; m <= 400; m += 20) {
      const { balance } = projectLoan(LOAN, m);
      expect(balance).toBeLessThanOrEqual(previous);
      expect(balance).toBeGreaterThanOrEqual(0);
      previous = balance;
    }
    expect(projectLoan(LOAN, 1200).balance).toBe(0);
  });

  test('interest falls as the capital is repaid', () => {
    const early = projectLoan(LOAN, 12).interest;
    const late = projectLoan(LOAN, 120).interest - projectLoan(LOAN, 108).interest;
    expect(late).toBeLessThan(early);
  });

  test('no loan projects to nothing', () => {
    expect(projectLoan(null, 120)).toEqual({ balance: 0, interest: 0, paid: 0 });
  });

  test('an instalment too small to cover the interest does not amortise', () => {
    const drowning: ArbitrageLoan = { balance: 100_000, rate: 10, payment: 100, insurance: 0 };
    expect(projectLoan(drowning, 12).balance).toBe(100_000);
    expect(payoffMonths(drowning)).toBe(Infinity);
  });
});

describe('payoffMonths', () => {
  test('agrees with the month the projection reaches zero', () => {
    const n = payoffMonths(LOAN);
    expect(projectLoan(LOAN, n).balance).toBe(0);
    expect(projectLoan(LOAN, n - 1).balance).toBeGreaterThan(0);
  });

  test('is zero without a loan', () => {
    expect(payoffMonths(null)).toBe(0);
  });
});

describe('capital-gains abatements', () => {
  test('nothing is abated before the 6th year', () => {
    expect(abatementIR(5)).toBe(0);
    expect(abatementPS(5)).toBe(0);
  });

  test('income tax is fully abated at 22 years, social charges at 30', () => {
    expect(abatementIR(22)).toBe(1);
    expect(abatementPS(22)).toBeLessThan(1);
    expect(abatementPS(30)).toBe(1);
  });

  test('both abatements only grow', () => {
    for (let y = 0; y < 35; y++) {
      expect(abatementIR(y + 1)).toBeGreaterThanOrEqual(abatementIR(y));
      expect(abatementPS(y + 1)).toBeGreaterThanOrEqual(abatementPS(y));
    }
  });

  test('the surtax only bites above 50 000 €', () => {
    expect(highGainSurtax(50_000)).toBe(0);
    expect(highGainSurtax(55_000)).toBeGreaterThan(0);
    expect(highGainSurtax(200_000)).toBeGreaterThan(highGainSurtax(120_000));
  });
});

describe('capitalGainsTax', () => {
  test('a primary residence owes nothing', () => {
    const cg = capitalGainsTax({
      property: { ...PROPERTY, isPrimaryResidence: true }, salePrice: 400_000, held: 10,
    });
    expect(cg.tax).toBe(0);
    expect(cg.exemptReason).toBe('primary_residence');
  });

  test('selling below the acquisition cost owes nothing', () => {
    const cg = capitalGainsTax({ property: PROPERTY, salePrice: 100_000, held: 10 });
    expect(cg.tax).toBe(0);
    expect(cg.exemptReason).toBe('no_gain');
  });

  test('the same gain is taxed less the longer it is held', () => {
    const short = capitalGainsTax({ property: PROPERTY, salePrice: 300_000, held: 7 });
    const long = capitalGainsTax({ property: PROPERTY, salePrice: 300_000, held: 18 });
    expect(long.tax).toBeLessThan(short.tax);
    expect(long.gross).toBeCloseTo(short.gross, 6);
  });

  test('income tax is gone at 22 years but social charges remain', () => {
    const cg = capitalGainsTax({ property: PROPERTY, salePrice: 300_000, held: 22 });
    expect(cg.abatementIR).toBe(1);
    expect(cg.tax).toBeGreaterThan(0);
    expect(capitalGainsTax({ property: PROPERTY, salePrice: 300_000, held: 30 }).tax).toBe(0);
  });

  test('the 15 % works forfait applies only past five years', () => {
    const under = capitalGainsTax({ property: PROPERTY, salePrice: 300_000, held: 4 });
    const over = capitalGainsTax({ property: PROPERTY, salePrice: 300_000, held: 6 });
    expect(over.acquisitionCost).toBeGreaterThan(under.acquisitionCost);
  });
});

describe('earlyRepaymentPenalty', () => {
  test('never exceeds either legal cap', () => {
    const outstanding = 80_000;
    const penalty = earlyRepaymentPenalty(LOAN, outstanding);
    expect(penalty).toBeLessThanOrEqual(outstanding * 0.03);
    expect(penalty).toBeLessThanOrEqual(outstanding * (LOAN.rate / 100) / 4);
  });

  test('is nil once the loan is cleared', () => {
    expect(earlyRepaymentPenalty(LOAN, 0)).toBe(0);
    expect(earlyRepaymentPenalty(null, 50_000)).toBe(0);
  });
});

describe('simulate', () => {
  test('the sell column adds up to its own total', () => {
    const r = simulate(PROPERTY, INPUTS, TODAY);
    const parts = r.sell.price - r.sell.sellingCosts - r.sell.loanRepaid
      - r.sell.earlyRepaymentPenalty - r.sell.capitalGains.tax;
    expect(parts).toBeCloseTo(r.sell.netProceeds, 6);
    expect(r.sell.cashBeforeSale + r.sell.netProceeds + r.sell.placementGain).toBeCloseTo(r.sell.total, 6);
  });

  test('the keep column adds up to its own total', () => {
    const r = simulate(PROPERTY, INPUTS, TODAY);
    expect(r.keep.value - r.keep.loanOutstanding).toBeCloseTo(r.keep.equity, 6);
    expect(r.keep.equity + r.keep.cashFlow).toBeCloseTo(r.keep.total, 6);
  });

  test('a future sale still balances, pre-sale cash flow included', () => {
    const r = simulate(PROPERTY, { ...INPUTS, sellMonths: 60 }, TODAY);
    expect(r.sell.cashBeforeSale).not.toBe(0);
    expect(r.sell.cashBeforeSale + r.sell.netProceeds + r.sell.placementGain).toBeCloseTo(r.sell.total, 6);
  });

  test('gap is the difference between the two totals', () => {
    const r = simulate(PROPERTY, INPUTS, TODAY);
    expect(r.gap).toBeCloseTo(r.sell.total - r.keep.total, 6);
  });

  test('both series start at the same net worth today', () => {
    const r = simulate(PROPERTY, { ...INPUTS, sellMonths: 36 }, TODAY);
    expect(r.series.sell[0]).toBeCloseTo(r.series.keep[0], 6);
    expect(r.series.sell).toHaveLength(INPUTS.horizonYears + 1);
  });

  test('selling at the horizon leaves almost nothing between the two', () => {
    const r = simulate(PROPERTY, { ...INPUTS, sellMonths: INPUTS.horizonYears * 12 }, TODAY);
    // Only the selling costs, the penalty and the capital-gains tax separate them.
    const frictions = r.sell.sellingCosts + r.sell.earlyRepaymentPenalty + r.sell.capitalGains.tax;
    expect(Math.abs(r.gap)).toBeLessThanOrEqual(frictions + 1);
  });

  test('a higher placement rate can only help selling', () => {
    const low = simulate(PROPERTY, { ...INPUTS, rate: 2 }, TODAY).gap;
    const high = simulate(PROPERTY, { ...INPUTS, rate: 11 }, TODAY).gap;
    expect(high).toBeGreaterThan(low);
  });

  test('a higher appreciation rate can only help keeping', () => {
    const flat = simulate(PROPERTY, { ...INPUTS, growth: 0 }, TODAY).gap;
    const rising = simulate(PROPERTY, { ...INPUTS, growth: 5 }, TODAY).gap;
    expect(rising).toBeLessThan(flat);
  });

  test('a costlier property is worth keeping less', () => {
    const cheap = simulate(PROPERTY, { ...INPUTS, annualCost: 2_000 }, TODAY).keep.total;
    const dear = simulate(PROPERTY, { ...INPUTS, annualCost: 9_000 }, TODAY).keep.total;
    expect(dear).toBeLessThan(cheap);
  });

  test('taxing the placement lowers both sides, never raises them', () => {
    const gross = simulate(PROPERTY, { ...INPUTS, taxPlacement: false }, TODAY);
    const net = simulate(PROPERTY, { ...INPUTS, taxPlacement: true }, TODAY);
    expect(net.sell.total).toBeLessThanOrEqual(gross.sell.total);
    expect(net.keep.total).toBeLessThanOrEqual(gross.keep.total);
  });

  test('a property with no loan is sold free of debt and penalty', () => {
    const r = simulate({ ...PROPERTY, loan: null }, INPUTS, TODAY);
    expect(r.sell.loanRepaid).toBe(0);
    expect(r.sell.earlyRepaymentPenalty).toBe(0);
    expect(r.keep.loanPaid).toBe(0);
    expect(r.loanPayoffMonths).toBe(0);
  });

  test('a sale beyond the horizon is clamped to the horizon', () => {
    const beyond = simulate(PROPERTY, { ...INPUTS, sellMonths: 999 }, TODAY);
    const atEnd = simulate(PROPERTY, { ...INPUTS, sellMonths: INPUTS.horizonYears * 12 }, TODAY);
    expect(beyond.sell.total).toBeCloseTo(atEnd.sell.total, 6);
  });
});

describe('yearsHeld', () => {
  test('counts from the purchase date and pushes out with the sale', () => {
    expect(yearsHeld('2020-01-01', 0, new Date('2030-01-01'))).toBeCloseTo(10, 1);
    expect(yearsHeld('2020-01-01', 60, new Date('2030-01-01'))).toBeCloseTo(15, 1);
  });

  test('never goes negative on a future purchase date', () => {
    expect(yearsHeld('2040-01-01', 0, new Date('2030-01-01'))).toBe(0);
  });
});
