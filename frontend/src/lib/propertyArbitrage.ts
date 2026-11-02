// Sell-or-hold arbitrage for one property.
//
// Compares two futures measured at the SAME horizon: selling at a chosen date and
// placing the proceeds, versus keeping the property and reinvesting its cash flow.
// The window between today and the sale is common to both, so it favours neither.
//
// Pure functions, no I/O — the page feeds them what /api/properties/:id/arbitrage returns.

export interface ArbitrageLoan {
  /** Capital still owed today, positive. */
  balance: number;
  /** Nominal annual rate, in percent (1.15 means 1.15 %). */
  rate: number;
  /** Monthly instalment including insurance. */
  payment: number;
  /** Insurance part of the instalment. */
  insurance: number;
}

export interface ArbitrageProperty {
  value: number;
  purchasePrice: number;
  notaryFees: number;
  works: number;
  /** ISO date. */
  purchaseDate: string;
  isPrimaryResidence: boolean;
  loan: ArbitrageLoan | null;
}

export interface ArbitrageInputs {
  /** Months from today to the sale. 0 = sell now. */
  sellMonths: number;
  /** Annual return of the placement, in percent. */
  rate: number;
  /** Annual appreciation of the property, in percent. */
  growth: number;
  /** Years from today to the comparison date. */
  horizonYears: number;
  /** Everything the property costs in a year: taxe foncière, copro, insurance,
   *  upkeep AND income tax on the rent. One figure, on purpose. */
  annualCost: number;
  /** Rent collected in a year. */
  annualRent: number;
  /** Selling costs today, in euros (agency, diagnostics). Grows with the price. */
  sellingCosts: number;
  /** Apply the 30 % PFU to the placement's gains. Without it the comparison
   *  flatters selling, since holding is taxed and the placement would not be. */
  taxPlacement: boolean;
}

export interface LoanProjection {
  /** Capital still owed after `months`. */
  balance: number;
  /** Interest paid over the window. */
  interest: number;
  /** Everything paid over the window, insurance included. */
  paid: number;
}

export interface CapitalGains {
  tax: number;
  gross: number;
  yearsHeld: number;
  acquisitionCost: number;
  abatementIR: number;
  abatementPS: number;
  /** Set when nothing is owed, saying why. */
  exemptReason: string | null;
}

export interface ArbitrageResult {
  sell: {
    /** Cash flow banked between today and the sale, already compounded. */
    cashBeforeSale: number;
    price: number;
    sellingCosts: number;
    loanRepaid: number;
    earlyRepaymentPenalty: number;
    capitalGains: CapitalGains;
    netProceeds: number;
    placementGain: number;
    total: number;
  };
  keep: {
    value: number;
    loanOutstanding: number;
    equity: number;
    rent: number;
    cost: number;
    loanPaid: number;
    loanInterest: number;
    /** Net cash flow over the horizon, compounded at the placement rate. */
    cashFlow: number;
    total: number;
  };
  /** sell.total − keep.total. Positive means selling wins. */
  gap: number;
  /** Payoff month of the loan, counted from today. */
  loanPayoffMonths: number;
  /** Net wealth year by year, index 0 = today, for both scenarios. */
  series: { sell: number[]; keep: number[] };
}

const PFU_RATE = 30;          // flat tax on the placement's gains
const CG_IR_RATE = 19;        // impôt sur le revenu on a property capital gain
const CG_PS_RATE = 17.2;      // prélèvements sociaux
const MS_PER_YEAR = 365.25 * 24 * 3600 * 1000;

/** Interest, capital and total paid over the first `months` instalments.
 *
 *  Projected from balance + rate + instalment rather than from
 *  loan_details.installments_paid, which the Powens and PDF rows disagree on
 *  (a loan started in May 2025 reports 53 instalments paid). Balance, rate and
 *  instalment are mutually consistent and reproduce the stored monthly breakdown. */
export function projectLoan(loan: ArbitrageLoan | null, months: number): LoanProjection {
  if (!loan || loan.balance <= 0) return { balance: 0, interest: 0, paid: 0 };
  const monthlyRate = loan.rate / 100 / 12;
  const amortising = loan.payment - loan.insurance;
  let balance = loan.balance;
  let interest = 0;
  let paid = 0;
  for (let m = 0; m < months && balance > 0; m++) {
    const due = balance * monthlyRate;
    const capital = Math.min(amortising - due, balance);
    if (capital <= 0) break;            // instalment does not even cover the interest
    interest += due;
    paid += capital + due + loan.insurance;
    balance = Math.max(0, balance - capital);
  }
  return { balance, interest, paid };
}

/** Months until the loan is cleared, from today. */
export function payoffMonths(loan: ArbitrageLoan | null): number {
  if (!loan || loan.balance <= 0) return 0;
  const monthlyRate = loan.rate / 100 / 12;
  const amortising = loan.payment - loan.insurance;
  if (monthlyRate === 0) return Math.ceil(loan.balance / amortising);
  if (amortising <= loan.balance * monthlyRate) return Infinity;
  return Math.ceil(-Math.log(1 - (loan.balance * monthlyRate) / amortising) / Math.log(1 + monthlyRate));
}

/** Years a property has been held, optionally pushing the sale `months` out. */
export function yearsHeld(purchaseDate: string, months = 0, today = new Date()): number {
  const bought = new Date(purchaseDate).getTime();
  if (!Number.isFinite(bought)) return 0;
  return Math.max(0, (today.getTime() - bought) / MS_PER_YEAR + months / 12);
}

/** Income-tax abatement: 6 %/year from the 6th to the 21st, 4 % on the 22nd. */
export function abatementIR(years: number): number {
  if (years < 6) return 0;
  if (years >= 22) return 1;
  return Math.min(1, (Math.floor(years) - 5) * 0.06);
}

/** Social-charges abatement: 1.65 %/year 6→21, 1.60 % on the 22nd, 9 %/year 23→30. */
export function abatementPS(years: number): number {
  if (years < 6) return 0;
  if (years >= 30) return 1;
  const n = Math.floor(years) - 5;
  if (n <= 16) return n * 0.0165;
  if (n === 17) return 16 * 0.0165 + 0.016;
  return Math.min(1, 16 * 0.0165 + 0.016 + (n - 17) * 0.09);
}

/** Surtax on a taxable gain above 50 000 €, 2 % to 6 %. */
export function highGainSurtax(taxableGain: number): number {
  const brackets: [number, number][] = [
    [50_000, 0], [60_000, 0.02], [100_000, 0.03],
    [110_000, 0.04], [150_000, 0.05], [160_000, 0.06],
  ];
  for (const [ceiling, rate] of brackets) if (taxableGain <= ceiling) return taxableGain * rate;
  return taxableGain * 0.06;
}

/** French plus-value immobilière on a sale, net of the duration abatements.
 *  A primary residence is exempt. With no works recorded, the 15 % forfait
 *  applies once the property has been held more than five years. */
export function capitalGainsTax(args: {
  property: ArbitrageProperty;
  salePrice: number;
  held: number;
}): CapitalGains {
  const { property, salePrice, held } = args;
  const base: CapitalGains = {
    tax: 0, gross: 0, yearsHeld: held, acquisitionCost: 0,
    abatementIR: abatementIR(held), abatementPS: abatementPS(held), exemptReason: null,
  };
  if (property.isPrimaryResidence) return { ...base, exemptReason: 'primary_residence' };

  const notary = property.notaryFees || property.purchasePrice * 0.075;
  const works = property.works || (held > 5 ? property.purchasePrice * 0.15 : 0);
  const acquisitionCost = property.purchasePrice + notary + works;
  const gross = Math.max(0, salePrice - acquisitionCost);
  if (gross <= 0) return { ...base, acquisitionCost, exemptReason: 'no_gain' };

  const taxableIR = gross * (1 - base.abatementIR);
  const taxablePS = gross * (1 - base.abatementPS);
  const tax = taxableIR * (CG_IR_RATE / 100) + taxablePS * (CG_PS_RATE / 100) + highGainSurtax(taxableIR);
  return { ...base, tax, gross, acquisitionCost, exemptReason: tax > 0 ? null : 'fully_abated' };
}

/** Legal cap on an early-repayment penalty: the lower of 3 % of the
 *  outstanding capital and three months of interest. */
export function earlyRepaymentPenalty(loan: ArbitrageLoan | null, outstanding: number): number {
  if (!loan || outstanding <= 0) return 0;
  return Math.min(outstanding * (loan.rate / 100) / 4, outstanding * 0.03);
}

export function simulate(property: ArbitrageProperty, inputs: ArbitrageInputs, today = new Date()): ArbitrageResult {
  const horizonMonths = inputs.horizonYears * 12;
  const saleMonth = Math.min(Math.max(0, inputs.sellMonths), horizonMonths);
  const monthlyRate = inputs.rate / 100 / 12;
  const monthlyGrowth = Math.pow(1 + inputs.growth / 100, 1 / 12);

  const valueAt = (month: number) => property.value * Math.pow(monthlyGrowth, month);
  /** Net of the 30 % PFU on whatever the placement earned above what was put in. */
  const afterPlacementTax = (value: number, contributed: number) =>
    inputs.taxPlacement && value > contributed ? value - (value - contributed) * (PFU_RATE / 100) : value;

  const monthlyCashFlow = (month: number) => {
    const owed = projectLoan(property.loan, month).balance;
    const instalment = property.loan && owed > 0 ? property.loan.payment : 0;
    return (inputs.annualRent - inputs.annualCost) / 12 - instalment;
  };

  // --- keep: run month by month, record net wealth every year
  let keepCash = 0;
  let keepContributed = 0;
  const keepSeries: number[] = [];
  for (let year = 0; year <= inputs.horizonYears; year++) {
    const month = year * 12;
    keepSeries.push(valueAt(month) - projectLoan(property.loan, month).balance + afterPlacementTax(keepCash, keepContributed));
    if (year === inputs.horizonYears) break;
    for (let k = 0; k < 12; k++) {
      const cf = monthlyCashFlow(month + k);
      keepCash = keepCash * (1 + monthlyRate) + cf;
      keepContributed += cf;
    }
  }

  // --- sell: identical until the sale, then everything sits in the placement
  let sellCash = 0;
  let sellContributed = 0;
  for (let m = 0; m < saleMonth; m++) {
    const cf = monthlyCashFlow(m);
    sellCash = sellCash * (1 + monthlyRate) + cf;
    sellContributed += cf;
  }
  const cashBeforeSale = sellCash;

  const atSale = projectLoan(property.loan, saleMonth);
  const price = valueAt(saleMonth);
  const sellingCosts = inputs.sellingCosts * Math.pow(monthlyGrowth, saleMonth);
  const penalty = earlyRepaymentPenalty(property.loan, atSale.balance);
  const held = yearsHeld(property.purchaseDate, saleMonth, today);
  const capitalGains = capitalGainsTax({ property, salePrice: price - sellingCosts, held });
  const netProceeds = price - sellingCosts - atSale.balance - penalty - capitalGains.tax;

  sellCash += netProceeds;
  sellContributed += netProceeds;
  const sellSeries: number[] = [];
  for (let year = 0; year <= inputs.horizonYears; year++) {
    const month = year * 12;
    sellSeries.push(month < saleMonth
      ? keepSeries[year]
      : afterPlacementTax(sellCash * Math.pow(1 + monthlyRate, month - saleMonth), sellContributed));
  }

  const sellTotal = sellSeries[inputs.horizonYears];
  const keepTotal = keepSeries[inputs.horizonYears];
  const atHorizon = projectLoan(property.loan, horizonMonths);

  return {
    sell: {
      cashBeforeSale, price, sellingCosts, loanRepaid: atSale.balance,
      earlyRepaymentPenalty: penalty, capitalGains, netProceeds,
      placementGain: sellTotal - netProceeds - cashBeforeSale,
      total: sellTotal,
    },
    keep: {
      value: valueAt(horizonMonths),
      loanOutstanding: atHorizon.balance,
      equity: valueAt(horizonMonths) - atHorizon.balance,
      rent: inputs.annualRent * inputs.horizonYears,
      cost: inputs.annualCost * inputs.horizonYears,
      loanPaid: atHorizon.paid,
      loanInterest: atHorizon.interest,
      cashFlow: afterPlacementTax(keepCash, keepContributed),
      total: keepTotal,
    },
    gap: sellTotal - keepTotal,
    loanPayoffMonths: payoffMonths(property.loan),
    series: { sell: sellSeries, keep: keepSeries },
  };
}
