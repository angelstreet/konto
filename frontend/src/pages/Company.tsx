import { useTranslation } from 'react-i18next';
import { Building2, Plus, Pencil, Trash2, Link, Unlink, Search, ChevronDown, Info } from 'lucide-react';
import { useState, useRef } from 'react';
import { useApi, invalidateApi } from '../useApi';
import ConfirmDialog from '../components/ConfirmDialog';

const API = '/kompta/api';

interface Company {
  id: number;
  name: string;
  siren: string | null;
  legal_form: string | null;
  address: string | null;
  naf_code: string | null;
  capital: number | null;
}

interface BankAccount {
  id: number;
  name: string;
  custom_name: string | null;
  bank_name: string | null;
  balance: number;
  company_id: number;
}

export default function CompanyPage() {
  const { t } = useTranslation();
  const { data: companies, loading: loadingCompanies, refetch: refetchCompanies } = useApi<Company[]>(`${API}/companies`);
  const { data: accounts, loading: loadingAccounts, refetch: refetchAccounts } = useApi<BankAccount[]>(`${API}/bank/accounts`);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [linkingCompanyId, setLinkingCompanyId] = useState<number | null>(null);
  const [form, setForm] = useState({ name: '', siren: '', legal_form: '', address: '', naf_code: '', capital: '', date_creation: '' });
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [showSearch, setShowSearch] = useState(false);
  const [selectedCompanyInfo, setSelectedCompanyInfo] = useState<any>(null);
  const searchTimeout = useRef<any>(null);
  const [confirmAction, setConfirmAction] = useState<{
    title: string;
    message: string;
    onConfirm: () => void;
  } | null>(null);

  const loading = loadingCompanies || loadingAccounts;

  const refetchAll = () => {
    invalidateApi(`${API}/dashboard`);
    refetchCompanies();
    refetchAccounts();
  };

  const resetForm = () => setForm({ name: '', siren: '', legal_form: '', address: '', naf_code: '', capital: '', date_creation: '' });

  const searchCompany = async (q: string) => {
    if (q.length < 2) { setSearchResults([]); setShowSearch(false); return; }
    clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(async () => {
      const res = await fetch(`${API}/companies/search?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      setSearchResults(data.results || []);
      setShowSearch(true);
    }, 300);
  };

  const [enrichedInfo, setEnrichedInfo] = useState<any>(null);
  const [enrichLoading, setEnrichLoading] = useState(false);
  const [showDetails, setShowDetails] = useState(true);

  const selectSearchResult = async (r: any) => {
    setForm({
      name: r.name || '',
      siren: r.siren || '',
      legal_form: r.legal_form || '',
      address: r.address || '',
      naf_code: r.naf_code || '',
      capital: '',
      date_creation: r.date_creation || '',
    });
    setSelectedCompanyInfo(r);
    setShowSearch(false);
    setSearchResults([]);
    setShowDetails(true);

    // Fetch enriched info (TVA, capital, RCS, etc.)
    if (r.siren) {
      setEnrichLoading(true);
      try {
        const res = await fetch(`${API}/companies/info/${r.siren}`);
        if (res.ok) {
          const data = await res.json();
          setEnrichedInfo(data);
          // Auto-fill form with enriched data
          setForm(prev => ({
            ...prev,
            capital: data.capital_social ? String(data.capital_social) : prev.capital,
            legal_form: data.legal_form || prev.legal_form,
            address: data.address || prev.address,
          }));
        }
      } catch {}
      setEnrichLoading(false);
    }
  };

  const startCreate = () => {
    resetForm();
    setEditingId(null);
    setSelectedCompanyInfo(null);
    setShowForm(true);
  };

  const startEdit = (c: Company) => {
    setForm({
      name: c.name,
      siren: c.siren || '',
      legal_form: c.legal_form || '',
      address: c.address || '',
      naf_code: c.naf_code || '',
      capital: c.capital ? String(c.capital) : '',
      date_creation: '',
    });
    setEditingId(c.id);
    setShowForm(true);
  };

  const saveCompany = async () => {
    const body = {
      name: form.name,
      siren: form.siren || null,
      legal_form: form.legal_form || null,
      address: form.address || null,
      naf_code: form.naf_code || null,
      capital: form.capital ? parseFloat(form.capital) : null,
    };

    if (editingId) {
      await fetch(`${API}/companies/${editingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } else {
      await fetch(`${API}/companies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    }
    setShowForm(false);
    setEditingId(null);
    resetForm();
    refetchAll();
  };

  const deleteCompany = (id: number) => {
    setConfirmAction({
      title: t('delete'),
      message: t('confirm_delete_company'),
      onConfirm: async () => {
        setConfirmAction(null);
        await fetch(`${API}/companies/${id}`, { method: 'DELETE' });
        refetchAll();
      },
    });
  };

  const linkAccount = async (accountId: number, companyId: number) => {
    await fetch(`${API}/bank/accounts/${accountId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ company_id: companyId }),
    });
    setLinkingCompanyId(null);
    refetchAll();
  };

  const unlinkAccount = async (accountId: number) => {
    await fetch(`${API}/bank/accounts/${accountId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ company_id: null }),
    });
    refetchAll();
  };

  const unlinkAllAccounts = (companyId: number) => {
    setConfirmAction({
      title: t('unlink_all'),
      message: t('confirm_unlink_all'),
      onConfirm: async () => {
        setConfirmAction(null);
        await fetch(`${API}/companies/${companyId}/unlink-all`, { method: 'POST' });
        refetchAll();
      },
    });
  };

  const linkedAccounts = (companyId: number) => (accounts || []).filter(a => a.company_id === companyId);
  const unlinkedAccounts = (accounts || []).filter(a => !a.company_id);

  const formatBalance = (n: number) =>
    new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(n);

  const legalForms = ['SARL', 'SAS', 'SASU', 'EURL', 'SA', 'SCI', 'Auto-entrepreneur', 'EI', 'Autre'];

  if (loading) return <div className="text-center text-muted py-8">Loading...</div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold">{t('company_profile')}</h1>
        <button
          onClick={startCreate}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors bg-accent-500 text-black"
        >
          <Plus size={16} />
          {t('add_company')}
        </button>
      </div>

      {/* Company form */}
      {showForm && (
        <div className="bg-surface rounded-xl border border-border p-5 mb-6">
          <h2 className="text-sm font-medium text-muted uppercase tracking-wide mb-4">
            {editingId ? t('edit_company') : t('new_company')}
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="relative col-span-full">
              <div className="flex items-center bg-black/30 border border-border rounded-lg px-3 py-2">
                <Search size={14} className="text-muted mr-2 flex-shrink-0" />
                <input
                  placeholder={t('search_or_enter_company')}
                  value={form.name}
                  onChange={e => { setForm({ ...form, name: e.target.value }); searchCompany(e.target.value); }}
                  onFocus={() => searchResults.length > 0 && setShowSearch(true)}
                  className="bg-transparent text-sm w-full outline-none"
                  autoComplete="off"
                />
              </div>
              {showSearch && searchResults.length > 0 && (
                <div className="absolute z-10 w-full mt-1 bg-surface border border-border rounded-lg shadow-xl max-h-60 overflow-y-auto">
                  {searchResults.map((r, i) => (
                    <button
                      key={i}
                      onClick={() => selectSearchResult(r)}
                      className="w-full text-left px-3 py-2.5 hover:bg-white/10 border-b border-border last:border-0"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-sm">{r.name}</span>
                        <span className={`text-xs px-1.5 py-0.5 rounded ${r.etat === 'active' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                          {r.etat}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted mt-0.5">
                        <span>SIREN: {r.siren}</span>
                        {r.code_postal && <span>{r.code_postal} {r.commune}</span>}
                        {r.date_creation && <span>Cr&eacute;&eacute;e: {r.date_creation}</span>}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <input
              placeholder="SIREN (9 chiffres)"
              value={form.siren}
              onChange={e => setForm({ ...form, siren: e.target.value })}
              className="bg-black/30 border border-border rounded-lg px-3 py-2 text-sm"
              maxLength={9}
            />
            <select
              value={form.legal_form}
              onChange={e => setForm({ ...form, legal_form: e.target.value })}
              className="bg-black/30 border border-border rounded-lg px-3 py-2 text-sm"
            >
              <option value="">{t('legal_form')}</option>
              {legalForms.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
            <input
              placeholder={t('capital')}
              value={form.capital}
              onChange={e => setForm({ ...form, capital: e.target.value })}
              className="bg-black/30 border border-border rounded-lg px-3 py-2 text-sm"
              type="number"
            />
            <input
              placeholder={t('address')}
              value={form.address}
              onChange={e => setForm({ ...form, address: e.target.value })}
              className="bg-black/30 border border-border rounded-lg px-3 py-2 text-sm col-span-full"
            />
          </div>
          {/* Company info — collapsible detail panel */}
          {(selectedCompanyInfo || enrichedInfo) && (
            <div className="col-span-full bg-black/20 border border-border rounded-lg mt-2 overflow-hidden">
              <button
                onClick={() => setShowDetails(!showDetails)}
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/5 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Info size={14} className="text-accent-400" />
                  <span className="text-xs text-muted uppercase tracking-wide font-medium">Informations juridiques</span>
                  {enrichLoading && <span className="text-xs text-muted animate-pulse">Chargement...</span>}
                </div>
                <div className="flex items-center gap-2">
                  {selectedCompanyInfo?.etat && (
                    <span className={`text-xs px-2 py-0.5 rounded-full ${selectedCompanyInfo.etat === 'active' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                      {selectedCompanyInfo.etat}
                    </span>
                  )}
                  <ChevronDown size={14} className={`text-muted transition-transform duration-200 ${showDetails ? '' : '-rotate-90'}`} />
                </div>
              </button>
              {showDetails && (
                <div className="px-4 pb-4">
                  {(() => {
                    const info = enrichedInfo || selectedCompanyInfo || {};
                    const sc = selectedCompanyInfo || {};
                    const fields = [
                      { label: 'SIREN', value: info.siren || sc.siren, mono: true },
                      { label: 'SIRET (siège)', value: info.siret || sc.siret, mono: true },
                      { label: 'Numéro TVA', value: info.tva_number, mono: true },
                      { label: 'Numéro RCS', value: info.rcs },
                      { label: 'Forme juridique', value: info.legal_form || sc.legal_form },
                      { label: 'Capital social', value: info.capital_social ? `${new Intl.NumberFormat('fr-FR').format(info.capital_social)} €` : null, accent: true },
                      { label: 'Date de création', value: info.date_creation || sc.date_creation },
                      { label: 'Adresse', value: info.address || sc.address, full: true },
                      { label: 'Code postal', value: info.postal_code || sc.code_postal },
                      { label: 'Ville', value: info.city || sc.commune },
                      { label: 'Code NAF', value: info.naf_code || sc.naf_code },
                      { label: 'Activité', value: info.naf_label },
                      { label: 'Catégorie', value: info.category || sc.categorie },
                      { label: 'Objet social', value: info.activity_description, full: true },
                      { label: 'Type d\'activité', value: info.activity_type },
                      { label: 'Noms commerciaux', value: info.brand_names },
                      { label: 'Convention collective', value: info.collective_agreement },
                    ];
                    return (
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2.5 text-sm">
                        {fields.filter(f => f.value).map((f, i) => (
                          <div key={i} className={f.full ? 'col-span-full' : ''}>
                            <p className="text-[10px] text-muted uppercase tracking-wide">{f.label}</p>
                            <p className={`${f.mono ? 'font-mono text-xs' : ''} ${f.accent ? 'text-accent-400 font-semibold' : ''}`}>
                              {f.value}
                            </p>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                  {/* Financial data from search */}
                  {selectedCompanyInfo?.finances && (
                    <div className="mt-3 pt-3 border-t border-border/50 grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2.5 text-sm">
                      <div>
                        <p className="text-[10px] text-muted uppercase tracking-wide">CA ({selectedCompanyInfo.finances.year})</p>
                        <p className="text-accent-400 font-semibold">
                          {selectedCompanyInfo.finances.ca ? new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(selectedCompanyInfo.finances.ca) : '—'}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] text-muted uppercase tracking-wide">Résultat net ({selectedCompanyInfo.finances.year})</p>
                        <p className={selectedCompanyInfo.finances.resultat_net >= 0 ? 'text-green-400 font-semibold' : 'text-red-400 font-semibold'}>
                        {selectedCompanyInfo.finances.resultat_net != null ? new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(selectedCompanyInfo.finances.resultat_net) : '—'}
                      </p>
                    </div>
                    </div>
                  )}
                  {/* Dirigeants */}
                  {selectedCompanyInfo?.dirigeants?.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-border/50">
                      <p className="text-[10px] text-muted uppercase tracking-wide mb-1.5">Dirigeants</p>
                      <div className="flex flex-wrap gap-2">
                        {selectedCompanyInfo.dirigeants.filter((d: any) => d.nom).map((d: any, i: number) => (
                          <span key={i} className="text-xs bg-white/5 px-2 py-1 rounded">
                            {d.nom} <span className="text-muted">({d.qualite})</span>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="flex gap-2 mt-4">
            <button
              onClick={saveCompany}
              disabled={!form.name}
              className="px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-40 bg-accent-500 text-black"
            >
              {editingId ? t('save') : t('create')}
            </button>
            <button
              onClick={() => { setShowForm(false); setEditingId(null); }}
              className="px-4 py-2 rounded-lg text-sm text-muted hover:text-white border border-border"
            >
              {t('cancel')}
            </button>
          </div>
        </div>
      )}

      {/* Company list */}
      {(companies || []).length === 0 && !showForm ? (
        <div className="bg-surface rounded-xl border border-border p-8 text-center">
          <Building2 className="mx-auto text-muted mb-3" size={32} />
          <p className="text-muted text-sm mb-4">{t('no_companies')}</p>
          <button
            onClick={startCreate}
            className="inline-flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-lg bg-accent-500 text-black"
          >
            <Plus size={14} />
            {t('add_company')}
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {(companies || []).map(c => {
            const linked = linkedAccounts(c.id);
            return (
              <div key={c.id} className="bg-surface rounded-xl border border-border p-5">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="font-semibold text-lg">{c.name}</h3>
                    <div className="flex items-center gap-3 mt-1 text-xs text-muted">
                      {c.legal_form && <span className="px-2 py-0.5 rounded-full bg-white/5">{c.legal_form}</span>}
                      {c.siren && <span className="font-mono">SIREN: {c.siren}</span>}
                      {c.capital && <span>Capital: {formatBalance(c.capital)}</span>}
                    </div>
                    {c.address && <p className="text-xs text-muted mt-1">{c.address}</p>}
                  </div>
                  <div className="flex items-center gap-1">
                    <button onClick={() => startEdit(c)} className="text-muted hover:text-white p-1"><Pencil size={14} /></button>
                    <button onClick={() => deleteCompany(c.id)} className="text-muted hover:text-red-400 p-1"><Trash2 size={14} /></button>
                  </div>
                </div>

                {/* Linked accounts */}
                <div className="border-t border-border pt-3 mt-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs text-muted uppercase tracking-wide">{t('linked_accounts')} ({linked.length})</span>
                    <div className="flex items-center gap-3">
                      {linked.length > 0 && (
                        <button
                          onClick={() => unlinkAllAccounts(c.id)}
                          className="text-xs flex items-center gap-1 hover:text-red-400 text-muted"
                        >
                          <Unlink size={12} /> {t('unlink_all')}
                        </button>
                      )}
                      <button
                        onClick={() => setLinkingCompanyId(linkingCompanyId === c.id ? null : c.id)}
                        className="text-xs flex items-center gap-1 hover:text-white text-muted"
                      >
                        <Link size={12} /> {t('link_account')}
                      </button>
                    </div>
                  </div>

                  {linked.length === 0 ? (
                    <p className="text-xs text-muted italic">{t('no_linked_accounts')}</p>
                  ) : (
                    <div className="space-y-1">
                      {linked.map(acc => (
                        <div key={acc.id} className="flex items-center justify-between py-1.5 px-2 rounded bg-white/5">
                          <div className="flex items-center gap-2">
                            {acc.bank_name && <span className="text-xs px-1.5 py-0.5 rounded bg-white/10 text-muted">{acc.bank_name}</span>}
                            <span className="text-sm">{acc.custom_name || acc.name}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-accent-400">{formatBalance(acc.balance)}</span>
                            <button onClick={() => unlinkAccount(acc.id)} className="text-muted hover:text-red-400" title={t('unlink')}>
                              <Unlink size={12} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Link account dropdown */}
                  {linkingCompanyId === c.id && unlinkedAccounts.length > 0 && (
                    <div className="mt-2 border border-border rounded-lg bg-black/30 p-2">
                      <p className="text-xs text-muted mb-2">{t('select_account_to_link')}</p>
                      {unlinkedAccounts.map(acc => (
                        <button
                          key={acc.id}
                          onClick={() => linkAccount(acc.id, c.id)}
                          className="w-full text-left flex items-center justify-between py-1.5 px-2 rounded hover:bg-white/10 text-sm"
                        >
                          <span>{acc.custom_name || acc.name} {acc.bank_name && `(${acc.bank_name})`}</span>
                          <span className="text-muted">{formatBalance(acc.balance)}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {linkingCompanyId === c.id && unlinkedAccounts.length === 0 && (
                    <p className="text-xs text-muted italic mt-2">{t('all_accounts_linked')}</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={!!confirmAction}
        title={confirmAction?.title || ''}
        message={confirmAction?.message || ''}
        variant="danger"
        onConfirm={() => confirmAction?.onConfirm()}
        onCancel={() => setConfirmAction(null)}
      />
    </div>
  );
}
