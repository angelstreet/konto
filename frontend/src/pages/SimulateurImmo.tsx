import { API } from '../config';
import { useState, useEffect, useMemo } from 'react';
import { useAuthFetch } from '../useApi';
import { ArrowLeft, Printer } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';

function fmt(v: number) {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(v);
}
function fmt2(v: number) {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 }).format(v);
}
function pct(v: number) { return v.toFixed(1) + '%'; }

function ratioColor(r: number) {
  if (r < 33) return 'text-emerald-400';
  if (r <= 35) return 'text-amber-400';
  return 'text-red-400';
}
function ratioBg(r: number) {
  if (r < 33) return 'bg-emerald-500';
  if (r <= 35) return 'bg-amber-500';
  return 'bg-red-500';
}

interface Rate { duration: number; avg_rate: number }
interface IncomeEntry { id: number; year: number; net_annual: number | null; gross_annual: number | null; company_id: number | null }
interface LoansResponse { summary: { monthly_total: number } }

export default function SimulateurImmo() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const authFetch = useAuthFetch();

  // --- Auto-loaded situation ---
  const [persoIncome, setPersoIncome] = useState(0);
  const [proIncome, setProIncome] = useState(0);
  const [persoRentalIncome, setPersoRentalIncome] = useState(0);
  const [proRentalIncome, setProRentalIncome] = useState(0);
  const [persoDebt, setPersoDebt] = useState(0);
  const [proDebt, setProDebt] = useState(0);
  const [loaded, setLoaded] = useState(false);

  // --- Property search ---
  const [address, setAddress] = useState('');
  const [addressResults, setAddressResults] = useState<{ label: string; citycode: string; lat: number; lon: number }[]>([]);
  const [selectedAddress, setSelectedAddress] = useState<{ citycode: string; lat: number; lon: number } | null>(null);
  const [surface, setSurface] = useState(50);
  const [propertyType, setPropertyType] = useState<'Appartement' | 'Maison'>('Appartement');
  const [dvfEstimate, setDvfEstimate] = useState<{ pricePerM2: number; comparables: number; range?: { low: number; high: number } } | null>(null);
  const [rentEstimate, setRentEstimate] = useState<{ estimated_rent: number; range: { low: number; high: number } } | null>(null);
  const [currentSavings, setCurrentSavings] = useState(0);

  // --- Project ---
  const [purchasePrice, setPurchasePrice] = useState(200000);
  const [notaryPct, setNotaryPct] = useState(8);
  const [travaux, setTravaux] = useState(0);
  const [apport, setApport] = useState(20000);

  // --- Financement ---
  const [interestRate, setInterestRate] = useState(3.35);
  const [insuranceRate, setInsuranceRate] = useState(0.34);
  const [duration, setDuration] = useState(20);

  // --- Revenus & Charges ---
  const [monthlyRent, setMonthlyRent] = useState(800);
  const [vacancyRate, setVacancyRate] = useState(5);
  const [taxeFonciere, setTaxeFonciere] = useState(1200);
  const [copropriete, setCopropriete] = useState(150);
  const [assurancePNO, setAssurancePNO] = useState(200);
  const [gestionPct, setGestionPct] = useState(7);
  const [entretien, setEntretien] = useState(50);

  // Fetch existing data
  useEffect(() => {
    Promise.all([
      authFetch(`${API}/income`).then(r => r.json()).catch(() => []),
      authFetch(`${API}/loans?usage=personal`).then(r => r.json()).catch(() => null),
      authFetch(`${API}/loans?usage=professional`).then(r => r.json()).catch(() => null),
      authFetch(`${API}/rates/current`).then(r => r.json()).catch(() => null),
      authFetch(`${API}/assets?type=real_estate`).then(r => r.json()).catch(() => []),
    ]).then(([incomeData, persoLoans, proLoans, ratesData, assetsData]) => {
      // Income: latest year, split by company_id
      const entries: IncomeEntry[] = Array.isArray(incomeData) ? incomeData : (incomeData?.entries || []);
      if (entries.length > 0) {
        const maxYear = Math.max(...entries.map(e => e.year));
        const latest = entries.filter(e => e.year === maxYear);
        const persoEntries = latest.filter(e => !e.company_id);
        const proEntries = latest.filter(e => !!e.company_id);
        const sumMonthly = (arr: IncomeEntry[]) => arr.reduce((s, e) => s + ((e.net_annual || e.gross_annual || 0) / 12), 0);
        setPersoIncome(Math.round(sumMonthly(persoEntries)));
        setProIncome(Math.round(sumMonthly(proEntries)));
      }

      // Loans
      if (persoLoans?.summary) setPersoDebt(Math.round((persoLoans as LoansResponse).summary.monthly_total));
      if (proLoans?.summary) setProDebt(Math.round((proLoans as LoansResponse).summary.monthly_total));

      // Rates
      if (ratesData?.rates) {
        const match = (ratesData.rates as Rate[]).find(r => r.duration === 20);
        if (match) setInterestRate(match.avg_rate);
      }

      // Rental income from existing real estate assets
      const assets: any[] = Array.isArray(assetsData) ? assetsData : (assetsData?.assets || []);
      const rentedAssets = assets.filter((a: any) => a.monthly_rent > 0);
      const persoRent = rentedAssets.filter((a: any) => a.usage !== 'professional').reduce((s: number, a: any) => s + (a.monthly_rent || 0), 0);
      const proRent = rentedAssets.filter((a: any) => a.usage === 'professional').reduce((s: number, a: any) => s + (a.monthly_rent || 0), 0);
      setPersoRentalIncome(Math.round(persoRent));
      setProRentalIncome(Math.round(proRent));

      // Fetch savings for banker's view
      authFetch(`${API}/dashboard`).then(r => r.json()).then(d => {
        const accs = [...(d?.financial?.accountsByType?.checking || []), ...(d?.financial?.accountsByType?.savings || [])];
        setCurrentSavings(accs.reduce((s: number, a: any) => s + Math.max(0, a.balance || 0), 0));
      }).catch(() => {});

      setLoaded(true);
    });
  }, []);

  // Address autocomplete
  const searchAddress = async (q: string) => {
    setAddress(q);
    if (q.length < 3) { setAddressResults([]); return; }
    try {
      const res = await fetch(`https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(q)}&limit=5`);
      const data = await res.json();
      setAddressResults((data.features || []).map((f: any) => ({
        label: f.properties.label,
        citycode: f.properties.citycode,
        lat: f.geometry.coordinates[1],
        lon: f.geometry.coordinates[0],
      })));
    } catch { setAddressResults([]); }
  };

  const selectAddress = (addr: { label: string; citycode: string; lat: number; lon: number }) => {
    setAddress(addr.label);
    setSelectedAddress({ citycode: addr.citycode, lat: addr.lat, lon: addr.lon });
    setAddressResults([]);
    // Auto-estimate property value + rent
    fetchEstimations(addr.citycode, addr.lat, addr.lon, surface, propertyType);
  };

  const fetchEstimations = async (citycode: string, lat: number, lon: number, surf: number, type: string) => {
    // DVF price estimation
    authFetch(`${API}/estimation/price?citycode=${citycode}&lat=${lat}&lon=${lon}&surface=${surf}&type=${type}`)
      .then(r => r.json())
      .then(d => {
        if (d.estimatedValue) {
          setPurchasePrice(Math.round(d.estimatedValue / 1000) * 1000);
          setDvfEstimate({ pricePerM2: d.pricePerM2, comparables: d.meta?.totalSales || 0, range: d.range });
        }
      }).catch(() => {});
    // Rent estimation
    authFetch(`${API}/estimation/rent?citycode=${citycode}&lat=${lat}&lon=${lon}&surface=${surf}&type=${type}`)
      .then(r => r.json())
      .then(d => {
        if (d.estimated_rent) {
          setMonthlyRent(d.estimated_rent);
          setRentEstimate(d);
        }
      }).catch(() => {});
    // Auto-estimate property tax
    setTaxeFonciere(Math.round(surf * 12));
  };

  // Re-estimate when surface or type changes (if address selected)
  useEffect(() => {
    if (selectedAddress && surface > 0) {
      fetchEstimations(selectedAddress.citycode, selectedAddress.lat, selectedAddress.lon, surface, propertyType);
    }
  }, [surface, propertyType]);

  // --- Calculations ---
  const notaryFees = useMemo(() => Math.round(purchasePrice * notaryPct / 100), [purchasePrice, notaryPct]);
  const totalProject = useMemo(() => purchasePrice + notaryFees + travaux, [purchasePrice, notaryFees, travaux]);
  const toBorrow = useMemo(() => Math.max(0, totalProject - apport), [totalProject, apport]);

  const monthlyLoanPayment = useMemo(() => {
    const mr = interestRate / 100 / 12;
    const m = duration * 12;
    if (mr === 0) return toBorrow / m;
    return toBorrow * mr / (1 - Math.pow(1 + mr, -m));
  }, [toBorrow, interestRate, duration]);

  const insuranceMonthly = useMemo(() => (toBorrow * insuranceRate / 100) / 12, [toBorrow, insuranceRate]);
  const totalMonthlyPayment = monthlyLoanPayment + insuranceMonthly;
  const totalLoanCost = useMemo(() => totalMonthlyPayment * duration * 12 - toBorrow, [totalMonthlyPayment, duration, toBorrow]);

  const effectiveRent = useMemo(() => monthlyRent * (1 - vacancyRate / 100), [monthlyRent, vacancyRate]);
  const gestionLocative = useMemo(() => monthlyRent * gestionPct / 100, [monthlyRent, gestionPct]);
  const totalMonthlyCharges = useMemo(() =>
    taxeFonciere / 12 + copropriete + assurancePNO / 12 + gestionLocative + entretien,
    [taxeFonciere, copropriete, assurancePNO, gestionLocative, entretien]
  );

  const cashflow = effectiveRent - totalMonthlyPayment - totalMonthlyCharges;
  const totalIncome = persoIncome + proIncome + persoRentalIncome + proRentalIncome;
  const totalDebt = persoDebt + proDebt;
  const currentDebtRatio = totalIncome > 0 ? (totalDebt / totalIncome) * 100 : 0;
  const newDebtRatio = totalIncome > 0 ? ((totalDebt + totalMonthlyPayment) / totalIncome) * 100 : 0;
  const grossYield = totalProject > 0 ? (monthlyRent * 12 / totalProject) * 100 : 0;
  const netYield = totalProject > 0 ? ((monthlyRent * 12 - totalMonthlyCharges * 12) / totalProject) * 100 : 0;

  const viability: 'VIABLE' | 'ATTENTION' | 'NON_VIABLE' =
    grossYield >= 5 && cashflow >= 0 ? 'VIABLE' :
    newDebtRatio < 33 && cashflow >= 0 ? 'VIABLE' :
    newDebtRatio <= 35 ? 'ATTENTION' : 'NON_VIABLE';
  const debtWarning = viability === 'VIABLE' && newDebtRatio > 35;

  // --- Banker's scoring ---
  const resteAVivre = totalIncome - (totalDebt + totalMonthlyPayment) - totalMonthlyCharges;
  const apportPct = totalProject > 0 ? (apport / totalProject) * 100 : 0;
  const savingsAfterApport = currentSavings - apport;
  const monthsReserve = (totalMonthlyPayment + totalMonthlyCharges) > 0 ? savingsAfterApport / (totalMonthlyPayment + totalMonthlyCharges) : 0;

  const bankerCriteria = [
    { label: "Taux d'endettement", value: pct(newDebtRatio), ok: newDebtRatio < 33 ? 'green' : newDebtRatio <= 35 ? 'amber' : 'red' },
    { label: 'Reste à vivre', value: fmt(resteAVivre) + '/mois', ok: resteAVivre > 1000 ? 'green' : resteAVivre > 700 ? 'amber' : 'red' },
    { label: 'Apport / Projet', value: pct(apportPct), ok: apportPct >= 20 ? 'green' : apportPct >= 10 ? 'amber' : 'red' },
    { label: 'Épargne résiduelle', value: `${Math.round(monthsReserve)} mois`, ok: monthsReserve >= 6 ? 'green' : monthsReserve >= 3 ? 'amber' : 'red' },
    { label: 'Cash flow net', value: fmt2(cashflow) + '/mois', ok: cashflow >= 0 ? 'green' : cashflow >= -100 ? 'amber' : 'red' },
    { label: 'Durée emprunt', value: `${duration} ans`, ok: duration <= 20 ? 'green' : duration <= 25 ? 'amber' : 'red' },
  ];
  const greenCount = bankerCriteria.filter(c => c.ok === 'green').length;
  const bankerVerdict = greenCount >= 5 ? 'Dossier solide' : greenCount >= 3 ? 'Dossier à renforcer' : 'Dossier insuffisant';
  const bankerVerdictColor = greenCount >= 5 ? 'text-emerald-400' : greenCount >= 3 ? 'text-amber-400' : 'text-red-400';
  const bankerVerdictBg = greenCount >= 5 ? 'bg-emerald-500/15 border-emerald-500/30' : greenCount >= 3 ? 'bg-amber-500/15 border-amber-500/30' : 'bg-red-500/15 border-red-500/30';

  const viabilityLabel = { VIABLE: t('immo_viable'), ATTENTION: t('immo_attention'), NON_VIABLE: t('immo_non_viable') };
  const viabilityColor = { VIABLE: 'text-emerald-400', ATTENTION: 'text-amber-400', NON_VIABLE: 'text-red-400' };
  const viabilityBg = { VIABLE: 'bg-emerald-500/15 border-emerald-500/30', ATTENTION: 'bg-amber-500/15 border-amber-500/30', NON_VIABLE: 'bg-red-500/15 border-red-500/30' };

  // --- Export for bank ---
  const exportForBank = () => {
    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Projet Immobilier — Dossier Bancaire</title>
<style>
  body { font-family: -apple-system, sans-serif; max-width: 800px; margin: 0 auto; padding: 40px 20px; color: #222; }
  h1 { font-size: 22px; border-bottom: 2px solid #d4a812; padding-bottom: 8px; }
  h2 { font-size: 16px; color: #555; margin-top: 32px; border-bottom: 1px solid #ddd; padding-bottom: 4px; }
  table { width: 100%; border-collapse: collapse; margin: 12px 0; }
  td { padding: 6px 8px; border-bottom: 1px solid #eee; }
  td:last-child { text-align: right; font-weight: 600; }
  .section { margin-bottom: 24px; }
  .verdict { font-size: 20px; font-weight: bold; text-align: center; padding: 16px; border-radius: 8px; margin: 24px 0; }
  .viable { background: #d1fae5; color: #065f46; }
  .attention { background: #fef3c7; color: #92400e; }
  .nonviable { background: #fee2e2; color: #991b1b; }
  .footer { margin-top: 40px; font-size: 11px; color: #999; text-align: center; }
  @media print { body { padding: 20px; } }
</style></head><body>
<h1>Projet Immobilier — Dossier Bancaire</h1>
<p style="color:#888">Généré le ${new Date().toLocaleDateString('fr-FR')}</p>

<h2>1. Situation actuelle</h2>
<table>
  <tr><td>Revenus mensuels personnels</td><td>${fmt(persoIncome)}</td></tr>
  <tr><td>Revenus mensuels professionnels</td><td>${fmt(proIncome)}</td></tr>
  <tr><td>Revenus locatifs personnels</td><td>${fmt(persoRentalIncome)}</td></tr>
  <tr><td>Revenus locatifs professionnels</td><td>${fmt(proRentalIncome)}</td></tr>
  <tr><td><strong>Total revenus mensuels</strong></td><td><strong>${fmt(totalIncome)}</strong></td></tr>
  <tr><td>Charges mensuelles personnelles</td><td>${fmt(persoDebt)}</td></tr>
  <tr><td>Charges mensuelles professionnelles</td><td>${fmt(proDebt)}</td></tr>
  <tr><td>Taux d'endettement actuel</td><td>${pct(currentDebtRatio)}</td></tr>
</table>

<h2>2. Projet</h2>
<table>
  <tr><td>Prix du bien</td><td>${fmt(purchasePrice)}</td></tr>
  <tr><td>Frais de notaire (${notaryPct}%)</td><td>${fmt(notaryFees)}</td></tr>
  <tr><td>Budget travaux</td><td>${fmt(travaux)}</td></tr>
  <tr><td><strong>Coût total du projet</strong></td><td><strong>${fmt(totalProject)}</strong></td></tr>
  <tr><td>Apport personnel</td><td>${fmt(apport)}</td></tr>
  <tr><td><strong>Montant à emprunter</strong></td><td><strong>${fmt(toBorrow)}</strong></td></tr>
</table>

<h2>3. Financement</h2>
<table>
  <tr><td>Durée</td><td>${duration} ans</td></tr>
  <tr><td>Taux d'intérêt</td><td>${pct(interestRate)}</td></tr>
  <tr><td>Taux assurance</td><td>${pct(insuranceRate)}</td></tr>
  <tr><td><strong>Mensualité (crédit + assurance)</strong></td><td><strong>${fmt2(totalMonthlyPayment)}</strong></td></tr>
  <tr><td>Coût total du crédit</td><td>${fmt(totalLoanCost)}</td></tr>
</table>

<h2>4. Revenus & Charges locatives</h2>
<table>
  <tr><td>Loyer mensuel estimé</td><td>${fmt(monthlyRent)}</td></tr>
  <tr><td>Vacance locative (${vacancyRate}%)</td><td>-${fmt(monthlyRent - effectiveRent)}</td></tr>
  <tr><td><strong>Loyer effectif</strong></td><td><strong>${fmt2(effectiveRent)}</strong></td></tr>
  <tr><td>Taxe foncière</td><td>${fmt(taxeFonciere)} /an</td></tr>
  <tr><td>Copropriété</td><td>${fmt(copropriete)} /mois</td></tr>
  <tr><td>Assurance PNO</td><td>${fmt(assurancePNO)} /an</td></tr>
  <tr><td>Gestion locative (${gestionPct}%)</td><td>${fmt2(gestionLocative)} /mois</td></tr>
  <tr><td>Entretien</td><td>${fmt(entretien)} /mois</td></tr>
  <tr><td><strong>Total charges mensuelles</strong></td><td><strong>${fmt2(totalMonthlyCharges)}</strong></td></tr>
</table>

<h2>5. Analyse de viabilité</h2>
<div class="verdict ${viability === 'VIABLE' ? 'viable' : viability === 'ATTENTION' ? 'attention' : 'nonviable'}">
  ${viabilityLabel[viability]}
</div>
<table>
  <tr><td>Cash flow mensuel</td><td style="color:${cashflow >= 0 ? '#059669' : '#dc2626'}">${fmt2(cashflow)}</td></tr>
  <tr><td>Rendement brut</td><td>${pct(grossYield)}</td></tr>
  <tr><td>Rendement net</td><td>${pct(netYield)}</td></tr>
  <tr><td>Taux d'endettement avant projet</td><td>${pct(currentDebtRatio)}</td></tr>
  <tr><td><strong>Taux d'endettement après projet</strong></td><td><strong>${pct(newDebtRatio)}</strong></td></tr>
</table>

<h2>6. Vision banquier — ${bankerVerdict}</h2>
<table>
${bankerCriteria.map(c => `  <tr><td>${c.label}</td><td style="color:${c.ok === 'green' ? '#059669' : c.ok === 'amber' ? '#d97706' : '#dc2626'}">${c.value} ${c.ok === 'green' ? '✓' : c.ok === 'amber' ? '⚠' : '✗'}</td></tr>`).join('\n')}
</table>
${dvfEstimate ? `<p style="font-size:12px;color:#888">Estimation DVF: ${dvfEstimate.pricePerM2.toLocaleString('fr-FR')} €/m² (${dvfEstimate.comparables} ventes comparables)</p>` : ''}
${rentEstimate ? `<p style="font-size:12px;color:#888">Loyer estimé: ${fmt(rentEstimate.estimated_rent)}/mois (${fmt(rentEstimate.range.low)} – ${fmt(rentEstimate.range.high)})</p>` : ''}

<div class="footer">Document généré par Konto — à titre indicatif uniquement</div>
</body></html>`;

    localStorage.setItem('konto_immo_last_export', html);
    localStorage.setItem('konto_immo_last_export_date', new Date().toISOString());
    const win = window.open('', '_blank');
    if (win) {
      win.document.write(html);
      win.document.close();
      setTimeout(() => win.print(), 300);
    }
  };

  const viewLastExport = () => {
    const html = localStorage.getItem('konto_immo_last_export');
    if (!html) return;
    const win = window.open('', '_blank');
    if (win) { win.document.write(html); win.document.close(); }
  };

  const lastExportDate = localStorage.getItem('konto_immo_last_export_date');
  const hasLastExport = !!localStorage.getItem('konto_immo_last_export');

  if (!loaded) {
    return <div className="text-sm text-muted py-8 text-center">Chargement…</div>;
  }

  return (
    <div className="space-y-4 max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 mb-2 h-10">
        <div className="flex items-center gap-2 min-w-0">
          <button onClick={() => navigate('/more')} className="md:hidden text-muted hover:text-white transition-colors p-1 -ml-1 flex-shrink-0">
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-xl font-semibold whitespace-nowrap">{t('tool_simulateur_immo')}</h1>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {hasLastExport && (
            <button onClick={viewLastExport} className="text-xs text-muted hover:text-white transition-colors px-2 py-1.5 whitespace-nowrap">
              {lastExportDate ? new Date(lastExportDate).toLocaleDateString('fr-FR') : 'Dernier'}
            </button>
          )}
          <button onClick={exportForBank} className="flex items-center gap-1.5 text-xs text-accent-400 hover:text-accent-300 transition-colors px-3 py-1.5 border border-accent-500/30 rounded-lg whitespace-nowrap">
            <Printer size={14} /> {t('immo_export_pdf')}
          </button>
        </div>
      </div>

      {/* Section 1: Ma situation actuelle */}
      <section className="bg-surface rounded-xl border border-border p-4">
        <h2 className="text-sm font-medium text-muted uppercase tracking-wide mb-3">{t('immo_section_situation')}</h2>
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div>
            <label className="text-xs text-muted block mb-1">{t('immo_personal_income')}</label>
            <input type="number" value={persoIncome} onChange={e => setPersoIncome(+e.target.value)}
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-xs text-muted block mb-1">{t('immo_pro_income')}</label>
            <input type="number" value={proIncome} onChange={e => setProIncome(+e.target.value)}
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-xs text-muted block mb-1">Revenus locatifs perso</label>
            <input type="number" value={persoRentalIncome} onChange={e => setPersoRentalIncome(+e.target.value)}
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-xs text-muted block mb-1">Revenus locatifs pro</label>
            <input type="number" value={proRentalIncome} onChange={e => setProRentalIncome(+e.target.value)}
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-xs text-muted block mb-1">{t('immo_personal_debt')}</label>
            <input type="number" value={persoDebt} onChange={e => setPersoDebt(+e.target.value)}
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-xs text-muted block mb-1">{t('immo_pro_debt')}</label>
            <input type="number" value={proDebt} onChange={e => setProDebt(+e.target.value)}
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm" />
          </div>
        </div>
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-muted">{t('immo_debt_ratio')}</span>
            <span className={`text-sm font-bold ${ratioColor(currentDebtRatio)}`}>{pct(currentDebtRatio)}</span>
          </div>
          <div className="w-full h-2 bg-white/5 rounded-full overflow-hidden">
            <div className={`h-full rounded-full transition-all ${ratioBg(currentDebtRatio)}`} style={{ width: `${Math.min(currentDebtRatio, 100)}%` }} />
          </div>
        </div>
      </section>

      {/* Section 2: Mon projet */}
      <section className="bg-surface rounded-xl border border-border p-4">
        <h2 className="text-sm font-medium text-muted uppercase tracking-wide mb-3">{t('immo_section_projet')}</h2>
        <div className="space-y-3">
          {/* Address autocomplete */}
          <div className="relative">
            <label className="text-xs text-muted block mb-1">Adresse du bien</label>
            <input
              value={address}
              onChange={e => searchAddress(e.target.value)}
              placeholder="Tapez une adresse..."
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm"
            />
            {addressResults.length > 0 && (
              <div className="absolute z-10 w-full bg-surface border border-border rounded-lg mt-1 shadow-xl max-h-48 overflow-y-auto">
                {addressResults.map((r, i) => (
                  <button key={i} onClick={() => selectAddress(r)} className="w-full text-left px-3 py-2 text-sm hover:bg-surface-hover">
                    {r.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted block mb-1">Surface (m²)</label>
              <input type="number" value={surface} onChange={e => setSurface(+e.target.value)}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs text-muted block mb-1">Type</label>
              <select value={propertyType} onChange={e => setPropertyType(e.target.value as any)}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm">
                <option value="Appartement">Appartement</option>
                <option value="Maison">Maison</option>
              </select>
            </div>
          </div>
          {dvfEstimate && (
            <div className="text-xs text-muted">
              DVF: {dvfEstimate.pricePerM2.toLocaleString('fr-FR')} €/m² ({dvfEstimate.comparables} ventes)
              {dvfEstimate.range && <> · {fmt(dvfEstimate.range.low)} – {fmt(dvfEstimate.range.high)}</>}
            </div>
          )}
          {rentEstimate && (
            <div className="text-xs text-muted">
              Loyer estimé: {fmt(rentEstimate.estimated_rent)}/mois ({fmt(rentEstimate.range.low)} – {fmt(rentEstimate.range.high)})
            </div>
          )}

          <div className="border-t border-border/50 pt-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted block mb-1">{t('immo_purchase_price')}</label>
              <input type="number" step={1000} value={purchasePrice} onChange={e => setPurchasePrice(+e.target.value)}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs text-muted block mb-1">{t('immo_notary_fees')} (%)</label>
              <input type="number" step={0.5} value={notaryPct} onChange={e => setNotaryPct(+e.target.value)}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 mt-3">
            <div className="flex items-center">
              <span className="text-xs text-muted">Frais notaire: {fmt(notaryFees)}</span>
            </div>
            <div className="flex items-end pb-2">
              <span className="text-sm text-muted">= {fmt(notaryFees)}</span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted block mb-1">{t('immo_travaux')}</label>
              <input type="number" step={1000} value={travaux} onChange={e => setTravaux(+e.target.value)}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs text-muted block mb-1">{t('immo_apport')}</label>
              <input type="number" step={1000} value={apport} onChange={e => setApport(+e.target.value)}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 mt-4">
          <div className="bg-black/20 rounded-lg p-3 text-center">
            <p className="text-xs text-muted mb-1">{t('immo_total_project')}</p>
            <p className="text-lg font-bold text-accent-400">{fmt(totalProject)}</p>
          </div>
          <div className="bg-black/20 rounded-lg p-3 text-center">
            <p className="text-xs text-muted mb-1">{t('immo_amount_to_borrow')}</p>
            <p className="text-lg font-bold text-white">{fmt(toBorrow)}</p>
          </div>
        </div>
      </section>

      {/* Section 3: Financement */}
      <section className="bg-surface rounded-xl border border-border p-4">
        <h2 className="text-sm font-medium text-muted uppercase tracking-wide mb-3">{t('immo_section_financement')}</h2>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="text-xs text-muted block mb-1">{t('immo_duration')} (ans)</label>
            <input type="number" min={5} max={30} step={1} value={duration} onChange={e => setDuration(+e.target.value)}
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-xs text-muted block mb-1">{t('immo_interest_rate')} (%)</label>
            <input type="number" step={0.01} value={interestRate} onChange={e => setInterestRate(+e.target.value)}
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-xs text-muted block mb-1">{t('immo_insurance_rate')} (%)</label>
            <input type="number" step={0.01} value={insuranceRate} onChange={e => setInsuranceRate(+e.target.value)}
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm" />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3 mt-4">
          <div className="bg-black/20 rounded-lg p-3 text-center">
            <p className="text-xs text-muted mb-1">{t('immo_monthly_payment')}</p>
            <p className="text-lg font-bold text-accent-400">{fmt2(totalMonthlyPayment)}</p>
          </div>
          <div className="bg-black/20 rounded-lg p-3 text-center">
            <p className="text-xs text-muted mb-1">{t('immo_insurance')}</p>
            <p className="text-lg font-bold text-purple-400">{fmt2(insuranceMonthly)}</p>
          </div>
          <div className="bg-black/20 rounded-lg p-3 text-center">
            <p className="text-xs text-muted mb-1">{t('immo_total_loan_cost')}</p>
            <p className="text-lg font-bold text-orange-400">{fmt(totalLoanCost)}</p>
          </div>
        </div>
      </section>

      {/* Section 4: Revenus & Charges */}
      <section className="bg-surface rounded-xl border border-border p-4">
        <h2 className="text-sm font-medium text-muted uppercase tracking-wide mb-3">{t('immo_section_revenus_charges')}</h2>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted block mb-1">{t('immo_expected_rent')}</label>
              <input type="number" step={50} value={monthlyRent} onChange={e => setMonthlyRent(+e.target.value)}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs text-muted block mb-1">{t('immo_vacancy_rate')} (%)</label>
              <input type="number" step={1} min={0} max={30} value={vacancyRate} onChange={e => setVacancyRate(+e.target.value)}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>
          <div className="text-sm text-muted">{t('immo_effective_rent')}: <span className="text-white font-medium">{fmt2(effectiveRent)}</span></div>

          <div className="border-t border-border/50 pt-3">
            <p className="text-xs text-muted uppercase tracking-wide mb-2">Charges</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted block mb-1">{t('immo_taxe_fonciere')}</label>
                <input type="number" step={100} value={taxeFonciere} onChange={e => setTaxeFonciere(+e.target.value)}
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="text-xs text-muted block mb-1">{t('immo_copropriete')}</label>
                <input type="number" step={10} value={copropriete} onChange={e => setCopropriete(+e.target.value)}
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="text-xs text-muted block mb-1">{t('immo_assurance_pno')}</label>
                <input type="number" step={50} value={assurancePNO} onChange={e => setAssurancePNO(+e.target.value)}
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="text-xs text-muted block mb-1">{t('immo_gestion_locative')} (%)</label>
                <input type="number" step={0.5} value={gestionPct} onChange={e => setGestionPct(+e.target.value)}
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="text-xs text-muted block mb-1">{t('immo_entretien')}</label>
                <input type="number" step={10} value={entretien} onChange={e => setEntretien(+e.target.value)}
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm" />
              </div>
            </div>
          </div>
        </div>
        <div className="bg-black/20 rounded-lg p-3 text-center mt-4">
          <p className="text-xs text-muted mb-1">{t('immo_total_charges')}</p>
          <p className="text-lg font-bold text-red-400">{fmt2(totalMonthlyCharges)}</p>
        </div>
      </section>

      {/* Section 5: Viability */}
      <section className="bg-surface rounded-xl border border-border p-4">
        <h2 className="text-sm font-medium text-muted uppercase tracking-wide mb-3">{t('immo_section_viabilite')}</h2>

        {/* Verdict */}
        <div className={`rounded-xl border p-4 text-center mb-4 ${viabilityBg[viability]}`}>
          <p className={`text-2xl font-bold ${viabilityColor[viability]}`}>{viabilityLabel[viability]}</p>
          {debtWarning && (
            <p className="text-xs text-amber-400 mt-1">Attention : taux d'endettement à {pct(newDebtRatio)} (seuil banque : 35%)</p>
          )}
        </div>

        {/* Key metrics */}
        <div className="grid grid-cols-3 gap-3 mb-4">
          <div className="bg-black/20 rounded-lg p-3 text-center">
            <p className="text-xs text-muted mb-1">{t('immo_cashflow')}</p>
            <p className={`text-lg font-bold ${cashflow >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{fmt2(cashflow)}</p>
          </div>
          <div className="bg-black/20 rounded-lg p-3 text-center">
            <p className="text-xs text-muted mb-1">{t('immo_gross_yield')}</p>
            <p className="text-lg font-bold text-accent-400">{pct(grossYield)}</p>
          </div>
          <div className="bg-black/20 rounded-lg p-3 text-center">
            <p className="text-xs text-muted mb-1">{t('immo_net_yield')}</p>
            <p className="text-lg font-bold text-accent-400">{pct(netYield)}</p>
          </div>
        </div>

        {/* Debt ratio comparison */}
        <div className="mb-2">
          <p className="text-xs text-muted uppercase tracking-wide mb-3">{t('immo_debt_ratio')}</p>
          <div className="space-y-3">
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-muted">{t('immo_debt_ratio_before')}</span>
                <span className={`text-sm font-bold ${ratioColor(currentDebtRatio)}`}>{pct(currentDebtRatio)}</span>
              </div>
              <div className="w-full h-3 bg-white/5 rounded-full overflow-hidden relative">
                <div className="absolute left-[33%] top-0 bottom-0 w-px bg-white/20" title="33%" />
                <div className={`h-full rounded-full transition-all ${ratioBg(currentDebtRatio)}`} style={{ width: `${Math.min(currentDebtRatio, 100)}%` }} />
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-muted">{t('immo_debt_ratio_after')}</span>
                <span className={`text-sm font-bold ${ratioColor(newDebtRatio)}`}>{pct(newDebtRatio)}</span>
              </div>
              <div className="w-full h-3 bg-white/5 rounded-full overflow-hidden relative">
                <div className="absolute left-[33%] top-0 bottom-0 w-px bg-white/20" title="33%" />
                <div className={`h-full rounded-full transition-all ${ratioBg(newDebtRatio)}`} style={{ width: `${Math.min(newDebtRatio, 100)}%` }} />
              </div>
            </div>
          </div>
        </div>

        {/* Cash flow chart */}
        <div className="mt-4">
          <p className="text-xs text-muted uppercase tracking-wide mb-3">{t('immo_monthly_breakdown')}</p>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={[
              { name: t('immo_rent'), value: effectiveRent },
              { name: t('immo_loan'), value: -totalMonthlyPayment },
              { name: 'Charges', value: -totalMonthlyCharges },
              { name: 'Cash flow', value: cashflow },
            ]} margin={{ top: 0, right: 5, bottom: 0, left: 5 }}>
              <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#888' }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={(v: number) => `${Math.round(v)}€`} tick={{ fontSize: 10, fill: '#888' }} axisLine={false} tickLine={false} width={50} />
              <Tooltip
                cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                contentStyle={{ backgroundColor: '#1a1a1a', border: '1px solid #333', borderRadius: 8, fontSize: 12, color: '#e5e5e5' }}
                formatter={(value: any) => [fmt2(Number(value)), '']}
              />
              <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                {[
                  { name: 'rent', color: '#22c55e' },
                  { name: 'loan', color: '#f97316' },
                  { name: 'charges', color: '#ef4444' },
                  { name: 'cashflow', color: cashflow >= 0 ? '#22c55e' : '#ef4444' },
                ].map((entry, i) => (
                  <Cell key={i} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* Section 6: Banker's View */}
      <section className="bg-surface rounded-xl border border-border p-4">
        <h2 className="text-sm font-medium text-muted uppercase tracking-wide mb-3">Vision banquier</h2>

        <div className={`rounded-xl border p-4 text-center mb-4 ${bankerVerdictBg}`}>
          <p className={`text-xl font-bold ${bankerVerdictColor}`}>{bankerVerdict}</p>
          <p className="text-xs text-muted mt-1">{greenCount}/6 critères validés</p>
        </div>

        <div className="space-y-2">
          {bankerCriteria.map((c, i) => (
            <div key={i} className="flex items-center justify-between py-2 border-b border-border/30 last:border-0">
              <div className="flex items-center gap-2">
                <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${c.ok === 'green' ? 'bg-emerald-500' : c.ok === 'amber' ? 'bg-amber-500' : 'bg-red-500'}`} />
                <span className="text-sm">{c.label}</span>
              </div>
              <span className={`text-sm font-semibold ${c.ok === 'green' ? 'text-emerald-400' : c.ok === 'amber' ? 'text-amber-400' : 'text-red-400'}`}>
                {c.value}
              </span>
            </div>
          ))}
        </div>

        <div className="mt-4 p-3 bg-black/20 rounded-lg text-xs text-muted space-y-1">
          <p>Les banques évaluent: taux d'endettement &lt; 33%, reste à vivre &gt; 700€/pers, apport &ge; 10%, épargne résiduelle &ge; 3 mois, durée &le; 25 ans.</p>
        </div>
      </section>
    </div>
  );
}
