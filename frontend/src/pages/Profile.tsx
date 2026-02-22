import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, User, Mail, Phone, MapPin, Save, Loader2 } from 'lucide-react';
import { API } from '../config';
import { useAuthFetch } from '../useApi';

interface ProfileData {
  id: number;
  email: string;
  name: string;
  phone: string | null;
  address: string | null;
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
  const [form, setForm] = useState({ name: '', phone: '', address: '' });

  useEffect(() => {
    authFetch(`${API}/profile`)
      .then(r => r.json())
      .then((data: ProfileData) => {
        setProfile(data);
        setForm({
          name: data.name || '',
          phone: data.phone || '',
          address: data.address || '',
        });
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    try {
      const res = await authFetch(`${API}/profile`, {
        method: 'PUT',
        body: JSON.stringify(form),
      });
      const data = await res.json();
      setProfile(data);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  const hasChanges = profile && (
    form.name !== (profile.name || '') ||
    form.phone !== (profile.phone || '') ||
    form.address !== (profile.address || '')
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
      <div className="flex items-center gap-2 mb-4 h-10">
        <button onClick={() => navigate('/settings')} className="md:hidden text-muted hover:text-white transition-colors p-1 -ml-1 flex-shrink-0">
          <ArrowLeft size={20} />
        </button>
        <h1 className="text-xl font-semibold whitespace-nowrap">{t('profile')}</h1>
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
          <label className="flex items-center gap-2 text-xs text-muted mb-1.5">
            <User size={14} />
            {t('name')}
          </label>
          <input
            type="text"
            value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            className="w-full bg-transparent rounded-lg px-3 py-2.5 text-sm border border-border focus:border-accent-500 focus:outline-none transition-colors"
            placeholder={t('your_name')}
          />
        </div>

        {/* Phone */}
        <div>
          <label className="flex items-center gap-2 text-xs text-muted mb-1.5">
            <Phone size={14} />
            {t('phone')}
          </label>
          <input
            type="tel"
            value={form.phone}
            onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
            className="w-full bg-transparent rounded-lg px-3 py-2.5 text-sm border border-border focus:border-accent-500 focus:outline-none transition-colors"
            placeholder={t('your_phone')}
          />
        </div>

        {/* Address */}
        <div>
          <label className="flex items-center gap-2 text-xs text-muted mb-1.5">
            <MapPin size={14} />
            {t('address')}
          </label>
          <textarea
            value={form.address}
            onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
            rows={2}
            className="w-full bg-transparent rounded-lg px-3 py-2.5 text-sm border border-border focus:border-accent-500 focus:outline-none transition-colors resize-none"
            placeholder={t('your_address')}
          />
        </div>

        {/* Member since */}
        <div className="text-xs text-muted pt-2 border-t border-border">
          {t('member_since')}: {profile?.created_at ? new Date(profile.created_at).toLocaleDateString() : '—'}
        </div>
      </div>

      {/* Save button */}
      <button
        onClick={handleSave}
        disabled={!hasChanges || saving}
        className={`w-full mt-4 flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-medium transition-colors ${
          saved
            ? 'bg-green-500/20 text-green-400 border border-green-500/30'
            : hasChanges
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
