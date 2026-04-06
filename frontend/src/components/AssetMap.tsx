import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

type Asset = {
  id: number;
  name: string;
  latitude: number | null;
  longitude: number | null;
  current_value: number | null;
  property_usage: string | null;
};

const USAGE_COLORS: Record<string, string> = {
  principal: '#3b82f6',
  rented_long: '#ef4444',
  rented_short: '#f59e0b',
  vacant: '#6b7280',
};

function formatCurrency(v: number) {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(v);
}

export default function AssetMap({ assets }: { assets: Asset[] }) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<L.Map | null>(null);

  const geoAssets = assets.filter(a => a.latitude && a.longitude);
  if (geoAssets.length === 0) return null;

  useEffect(() => {
    if (!mapRef.current || mapInstance.current) return;

    const map = L.map(mapRef.current, {
      zoomControl: false,
      attributionControl: false,
      scrollWheelZoom: false,
      dragging: true,
    });
    mapInstance.current = map;

    // Dark tile layer
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 18,
    }).addTo(map);

    // Add markers
    const markers: L.LatLng[] = [];
    for (const asset of geoAssets) {
      const lat = asset.latitude!;
      const lng = asset.longitude!;
      const color = USAGE_COLORS[asset.property_usage || ''] || '#ef4444';
      markers.push(L.latLng(lat, lng));

      const usageLabel = asset.property_usage === 'principal' ? 'Résidence principale'
        : asset.property_usage === 'rented_long' ? 'Location longue durée'
        : asset.property_usage === 'rented_short' ? 'Location saisonnière'
        : asset.property_usage === 'vacant' ? 'Vacant' : '';

      const marker = L.circleMarker([lat, lng], {
        radius: 8,
        fillColor: color,
        color: '#fff',
        weight: 2,
        fillOpacity: 0.9,
      }).addTo(map);

      marker.bindPopup(`
        <div style="font-family:sans-serif;font-size:13px;min-width:140px">
          <strong>${asset.name}</strong><br>
          ${usageLabel ? `<span style="color:#888">${usageLabel}</span><br>` : ''}
          ${asset.current_value ? `<span style="color:#d4a812;font-weight:600">${formatCurrency(asset.current_value)}</span>` : ''}
        </div>
      `);
    }

    // Fit bounds with padding
    if (markers.length > 0) {
      const bounds = L.latLngBounds(markers);
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 10 });
    }

    return () => {
      map.remove();
      mapInstance.current = null;
    };
  }, [geoAssets.length]);

  return (
    <div className="bg-surface rounded-xl border border-border overflow-hidden">
      <div ref={mapRef} style={{ height: 280, width: '100%' }} />
      <div className="flex flex-wrap gap-3 px-3 py-2 text-[11px] text-muted">
        {Object.entries(USAGE_COLORS).map(([key, color]) => (
          <span key={key} className="flex items-center gap-1">
            <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
            {key === 'principal' ? 'Résidence' : key === 'rented_long' ? 'Location LD' : key === 'rented_short' ? 'Location CD' : 'Vacant'}
          </span>
        ))}
      </div>
    </div>
  );
}
