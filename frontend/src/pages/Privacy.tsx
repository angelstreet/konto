import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function Privacy() {
  const navigate = useNavigate();

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-muted hover:text-white mb-6">
        <ArrowLeft size={18} /> Retour
      </button>

      <h1 className="text-2xl font-bold mb-6">Politique de Confidentialité</h1>
      <p className="text-muted text-sm mb-6">Dernière mise à jour : Février 2026</p>

      <div className="space-y-6 text-sm text-[#ccc] leading-relaxed">
        <section>
          <h2 className="text-lg font-semibold text-white mb-2">1. Responsable du traitement</h2>
          <p>Konto est un outil de gestion financière personnelle. Le responsable du traitement de vos données est l'administrateur de l'instance Konto que vous utilisez.</p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-white mb-2">2. Données collectées</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>Données de compte :</strong> email, nom (via Clerk, fournisseur d'authentification)</li>
            <li><strong>Données financières :</strong> comptes bancaires, transactions, soldes, investissements — synchronisés via Powens (agrégateur bancaire agréé ACPR) ou saisis manuellement</li>
            <li><strong>Données patrimoniales :</strong> biens immobiliers, véhicules, actifs divers</li>
            <li><strong>Données professionnelles :</strong> informations d'entreprise (SIREN, raison sociale) — issues de registres publics</li>
            <li><strong>Documents :</strong> factures et justificatifs via Google Drive (avec votre autorisation explicite)</li>
          </ul>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-white mb-2">3. Base légale du traitement</h2>
          <p>Le traitement de vos données repose sur :</p>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>Votre consentement</strong> pour la connexion de comptes bancaires et de services tiers</li>
            <li><strong>L'exécution du contrat</strong> pour le fonctionnement du service</li>
            <li><strong>L'intérêt légitime</strong> pour la sécurité et la prévention de la fraude</li>
          </ul>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-white mb-2">4. Stockage et sécurité</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li>Les données sont stockées dans une base de données <strong>Turso</strong> (SQLite distribué), hébergée en Europe</li>
            <li>L'authentification est gérée par <strong>Clerk</strong>, certifié SOC 2 Type II</li>
            <li>Toutes les communications sont chiffrées en transit (<strong>HTTPS/TLS</strong>)</li>
            <li>Les tokens bancaires sont stockés côté serveur et ne sont jamais exposés au navigateur</li>
            <li>Aucune donnée de carte bancaire n'est stockée par Konto</li>
          </ul>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-white mb-2">5. Partage des données</h2>
          <p>Vos données ne sont <strong>jamais vendues</strong>. Elles sont partagées uniquement avec :</p>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>Powens</strong> (agrégateur bancaire) — pour la synchronisation des comptes</li>
            <li><strong>Clerk</strong> — pour l'authentification</li>
            <li><strong>Turso</strong> — pour le stockage des données</li>
            <li><strong>Google Drive</strong> — uniquement si vous connectez votre Drive pour les factures</li>
            <li><strong>Coinbase / Binance</strong> — uniquement si vous connectez vos comptes crypto</li>
          </ul>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-white mb-2">6. Cookies</h2>
          <p>Konto utilise uniquement des <strong>cookies essentiels</strong> :</p>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>Session Clerk</strong> — authentification</li>
            <li><strong>Préférences locales</strong> (localStorage) — thème, langue, états d'affichage</li>
          </ul>
          <p className="mt-2"><strong>Aucun cookie publicitaire, de suivi ou analytique</strong> n'est utilisé. Aucun outil de tracking (Google Analytics, etc.) n'est intégré.</p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-white mb-2">7. Vos droits (RGPD)</h2>
          <p>Conformément au Règlement Général sur la Protection des Données (RGPD), vous disposez des droits suivants :</p>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>Droit d'accès :</strong> consulter vos données via Paramètres → Exporter mes données</li>
            <li><strong>Droit de rectification :</strong> modifier vos informations dans l'application</li>
            <li><strong>Droit à l'effacement :</strong> supprimer définitivement votre compte et toutes vos données via Paramètres → Supprimer mon compte</li>
            <li><strong>Droit à la portabilité :</strong> exporter vos données au format JSON</li>
            <li><strong>Droit d'opposition :</strong> vous pouvez déconnecter vos comptes bancaires à tout moment</li>
          </ul>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-white mb-2">8. Durée de conservation</h2>
          <p>Vos données sont conservées tant que votre compte est actif. En cas de suppression de compte, <strong>toutes les données sont effacées immédiatement et définitivement</strong> de nos systèmes.</p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-white mb-2">9. Contact</h2>
          <p>Pour toute question relative à vos données personnelles, contactez-nous à l'adresse indiquée dans les paramètres de l'application.</p>
        </section>
      </div>
    </div>
  );
}
