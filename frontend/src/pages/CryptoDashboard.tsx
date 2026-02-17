import React from 'react';
import { useTranslation } from 'react-i18next';
import { Bitcoin } from 'lucide-react';
import { useAmountVisibility } from '../AmountVisibilityContext';

export default function CryptoDashboard() {
  const { t } = useTranslation();
  const { hideAmounts } = useAmountVisibility();

  // Simulate no wallets for empty state
  const wallets = [];

  if (wallets.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] py-12 text-center text-gray-400 space-y-6">
        <Bitcoin size={80} className="mx-auto opacity-30 text-orange-400" />
        <div className="max-w-md mx-auto space-y-4">
          <h1 className="text-3xl md:text-4xl font-bold bg-gradient-to-r from-orange-400 to-yellow-400 bg-clip-text text-transparent mb-2">
            Crypto
          </h1>
          <p className="text-xl md:text-2xl font-semibold text-white/80">
            Aucun portefeuille crypto
          </p>
          <p className="text-lg opacity-75">
            Ajoutez Ledger, Coinbase ou votre wallet préféré pour commencer à suivre vos cryptos.
          </p>
        </div>
        <button 
          className="bg-gradient-to-r from-orange-500 via-orange-600 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white px-12 py-5 rounded-3xl font-bold text-lg shadow-2xl hover:shadow-3xl transition-all duration-200 transform hover:-translate-y-1 active:translate-y-0.5 w-full max-w-sm"
          onClick={() => {
            // TODO: open add wallet modal
            alert('Ajouter un portefeuille (TODO #728)');
          }}
        >
          + Ajouter un portefeuille
        </button>
        <p className="text-sm opacity-50">
          {hideAmounts ? '💸' : 'Valeurs en temps réel via CoinGecko'}
        </p>
      </div>
    );
  }

  // Full dashboard placeholder (when wallets exist)
  return (
    <div>
      <h1>Crypto Dashboard (TODO full impl #726+)</h1>
      <p>Liste des wallets et assets à venir.</p>
    </div>
  );
}