import AssetClassShell from '../components/assets/AssetClassShell';
import { useCallback } from 'react';

export default function Crypto() {
  const filter = useCallback((a: any) => a.type === 'investment' && a.subtype === 'crypto', []);
  return (
    <AssetClassShell
      title="Crypto"
      accountFilter={filter}
      emptyHint="Aucun compte crypto trouvé. Connectez un wallet/exchange ou synchronisez vos comptes."
    />
  );
}
