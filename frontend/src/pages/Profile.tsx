import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, User, Mail, Phone, MapPin, Save, Loader2, Globe } from 'lucide-react';
import { API } from '../config';
import { useAuthFetch } from '../useApi';

const STORAGE_KEYS = {
  name: 'konto_user_name',
  phone: 'konto_user_phone',
  address: 'konto_user_address',
};

interface ProfileData {
  id: number;
  email: string;
  city: string | null;
  country: string | null;
  created_at: string;
}

export default function Profile() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const authFetch = useAuthFetch();
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [localSaved, setLocalSaved] = useState({ name: false, phone: false, address: false });
  const [form, setForm] = useState({
    name: '',
    phone: '',
    address: '',
    city: '',
    country: '',
  });

  // Load localStorage values
  const loadFromStorage = () => ({
    name: localStorage.getItem(STORAGE_KEYS.name) || '',
    phone: localStorage.getItem(STORAGE_KEYS.phone) || '',
    address: localStorage.getItem(STORAGE_KEYS.address) || '',
  });

  // Save to localStorage
  const saveToStorage = (key: 'name' | 'phone' | 'address', value: string) => {
    localStorage.setItem(STORAGE_KEYS[key], value);
    setLocalSaved(prev => ({ ...prev, [key]: true }));
    setTimeout(() => setLocalSaved(prev => ({ ...prev, [key]: false })), 1500);
  };

  useEffect(() => {
    // Load local values first (instant)
    const stored = loadFromStorage();
    setForm(prev => ({ ...prev, ...stored }));

    // Then fetch API for city/country
    authFetch(`${API}/profile`)
      .then(r => r.json())
      .then((data: ProfileData) => {
        setProfile(data);
        setForm(prev => ({
          ...prev,
          city: data.city || '',
          country: data.country || '',
        }));
        
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const handleFieldChange = (field: 'name' | 'phone' | 'address', value: string) => {
    setForm(f => ({ ...f, [field]: value }));
    saveToStorage(field, value);
  };

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    try {
      const res = await authFetch(`${API}/profile`, {
        method: 'PUT',
        body: JSON.stringify({ city: form.city, country: form.country }),
      });
      const data = await res.json();
      setProfile(data);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  const hasApiChanges = profile && (
    form.city !== (profile.city || '') ||
    form.country !== (profile.country || '')
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 size={24} className="animate-spin text-muted" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-2 h-10">
        <div className="flex items-center gap-1 min-w-0">
          <button onClick={() => navigate('/settings')} className="md:hidden text-muted hover:text-white transition-colors p-1 -ml-1 flex-shrink-0">
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-xl font-semibold whitespace-nowrap">{t('profile')}</h1>
        </div>
      </div>

      <div className="bg-surface rounded-xl border border-border p-4 space-y-4">
        {/* Email (read-only) */}
        <div>
          <label className="flex items-center gap-2 text-xs text-muted mb-1.5">
            <Mail size={14} />
            {t('email')}
          </label>
          <div className="w-full bg-surface-hover rounded-lg px-3 py-2.5 text-sm text-muted border border-border">
            {profile?.email}
          </div>
        </div>

        {/* Name */}
        <div>
          <label className="flex items-center justify-between text-xs text-muted mb-1.5">
            <span className="flex items-center gap-2">
              <User size={14} />
              {t('name')}
            </span>
            {localSaved.name && <span className="text-green-400 text-[10px]">✓ {t('saved_locally')}</span>}
          </label>
          <input
            type="text"
            value={form.name}
            onChange={e => handleFieldChange('name', e.target.value)}
            className="w-full bg-transparent rounded-lg px-3 py-2.5 text-sm border border-border focus:border-accent-500 focus:outline-none transition-colors"
            placeholder={t('your_name')}
          />
        </div>

        {/* Phone */}
        <div>
          <label className="flex items-center justify-between text-xs text-muted mb-1.5">
            <span className="flex items-center gap-2">
              <Phone size={14} />
              {t('phone')}
            </span>
            {localSaved.phone && <span className="text-green-400 text-[10px]">✓ {t('saved_locally')}</span>}
          </label>
          <input
            type="tel"
            value={form.phone}
            onChange={e => handleFieldChange('phone', e.target.value)}
            className="w-full bg-transparent rounded-lg px-3 py-2.5 text-sm border border-border focus:border-accent-500 focus:outline-none transition-colors"
            placeholder={t('your_phone')}
          />
        </div>

        {/* Address */}
        <div>
          <label className="flex items-center justify-between text-xs text-muted mb-1.5">
            <span className="flex items-center gap-2">
              <MapPin size={14} />
              {t('address')}
            </span>
            {localSaved.address && <span className="text-green-400 text-[10px]">✓ {t('saved_locally')}</span>}
          </label>
          <textarea
            value={form.address}
            onChange={e => handleFieldChange('address', e.target.value)}
            rows={2}
            className="w-full bg-transparent rounded-lg px-3 py-2.5 text-sm border border-border focus:border-accent-500 focus:outline-none transition-colors resize-none"
            placeholder={t('your_address')}
          />
        </div>

        {/* City */}
        <div>
          <label className="flex items-center gap-2 text-xs text-muted mb-1.5">
            <Globe size={14} />
            {t('city')}
          </label>
          <input
            type="text"
            value={form.city}
            onChange={e => setForm(f => ({ ...f, city: e.target.value }))}
            className="w-full bg-transparent rounded-lg px-3 py-2.5 text-sm border border-border focus:border-accent-500 focus:outline-none transition-colors"
            placeholder={t('your_city')}
          />
        </div>

        {/* Country */}
        <div>
          <label className="flex items-center gap-2 text-xs text-muted mb-1.5">
            <Globe size={14} />
            {t('country')}
          </label>
          <select
            value={form.country}
            onChange={e => setForm(f => ({ ...f, country: e.target.value }))}
            className="w-full bg-transparent rounded-lg px-3 py-2.5 text-sm border border-border focus:border-accent-500 focus:outline-none transition-colors"
          >
            <option value="">{t('select_country')}</option>
            <option value="FR">France</option>
            <option value="CH">Switzerland</option>
            <option value="DE">Germany</option>
            <option value="BE">Belgium</option>
            <option value="UK">United Kingdom</option>
            <option value="US">United States</option>
            <option value="其他">Other</option>
          </select>
        </div>

        {/* Member since */}
        <div className="text-xs text-muted pt-2 border-t border-border">
          {t('member_since')}: {profile?.created_at ? new Date(profile.created_at).toLocaleDateString() : '—'}
        </div>
      </div>

      {/* Save button */}
      <button
        onClick={handleSave}
        disabled={!hasApiChanges || saving}
        className={`w-full mt-4 flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-medium transition-colors ${
          saved
            ? 'bg-green-500/20 text-green-400 border border-green-500/30'
            : hasApiChanges
              ? 'bg-accent-500 text-white hover:bg-accent-600'
              : 'bg-surface text-muted border border-border cursor-not-allowed'
        }`}
      >
        {saving ? (
          <Loader2 size={16} className="animate-spin" />
        ) : saved ? (
          <>✓ {t('saved')}</>
        ) : (
          <><Save size={16} /> {t('save')}</>
        )}
      </button>
    </div>
  );
}
