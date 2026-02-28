import AssetClassShell from '../components/assets/AssetClassShell';
import { useCallback } from 'react';

export default function ActionsFunds() {
  const filter = useCallback((a: any) => a.type === 'investment' && a.subtype !== 'crypto', []);
  return (
    <AssetClassShell
      title="Actions & Fonds"
      accountFilter={filter}
      emptyHint="Aucun compte Actions & Fonds trouvé. Synchronisez vos comptes d'investissement."
    />
  );
}
