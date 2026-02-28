# Property Estimation (Konto)

## Purpose
Konto stores **two distinct values** for each real-estate asset:

- `current_value` → user-entered value ("Votre estimation")
- `estimated_value` → market value computed from DVF sales ("Estimation marché")

This separation is intentional: manual valuation is preserved, market valuation is refreshed automatically.

---

## Current API flow

### 1) Geocode
`GET /api/estimation/geocode?q=<address>`

Uses `api-adresse.data.gouv.fr` to return:
- label
- citycode (INSEE)
- latitude / longitude

### 2) Market estimation
`GET /api/estimation/price?citycode=<insee>&lat=<lat>&lon=<lon>&surface=<m2>&type=<Maison|Appartement>`

Uses DVF CSV (`files.data.gouv.fr/geo-dvf/latest/csv/{year}/communes/{dept}/{citycode}.csv`) for years:
- 2024
- 2023
- 2022

Algorithm:
1. Keep `nature_mutation = Vente`
2. Keep property types `Maison` or `Appartement`
3. Compute €/m² (`valeur_fonciere / surface_reelle_bati`)
4. Prefer same type if >= 5 records, else fallback to mixed set
5. Sort by geographic distance, keep nearest 50 comparables
6. Compute median/mean + p25/p75
7. Return:
   - `pricePerM2`
   - `estimatedValue`
   - `range`
   - `comparables` (top 10)

Core implementation is centralized in:
- `backend/src/services/propertyEstimation.ts`

---

## Nightly refresh (new)

A cron job refreshes all real-estate market estimates daily:

- Job file: `backend/src/jobs/refreshPropertyEstimations.ts`
- Schedule: **03:00 daily** (`0 3 * * *`)
- Cron monitor name: `refresh-property-estimations`

It scans assets where:
- `type = 'real_estate'`
- `citycode IS NOT NULL`
- `surface > 0`

For each asset:
- recomputes DVF estimate
- updates:
  - `estimated_value`
  - `estimated_price_m2`
  - `estimation_date`

It does **not** modify `current_value`.

---

## Manual trigger / verification

### Manual refresh endpoint
`POST /api/estimation/refresh-all`

Response:
```json
{
  "ok": true,
  "scanned": 12,
  "updated": 10,
  "skipped": 2,
  "errors": []
}
```

### Example local check
```bash
curl -sk "https://127.0.0.1:8080/konto/api/estimation/geocode?q=6%20impasse%20Fabigyl%2013180%20Gignac-la-Nerthe"

curl -sk "https://127.0.0.1:8080/konto/api/estimation/price?citycode=13043&lat=43.39749&lon=5.234541&surface=115&type=Maison"
```

Expected output includes:
- `estimatedValue: 448637`
- `pricePerM2: 3901`

---

## Frontend mapping (Assets page)

- `estimated_value` / `estimated_price_m2` shown as **Estimation marché (DVF)**
- `current_value` shown as **Votre estimation**
- `% vs marché` computed from `(current_value - estimated_value) / estimated_value`

---

## Why this design

- Keeps user control (`current_value` is never overwritten)
- Keeps market data fresh automatically
- Makes valuation transparent (comparables + ranges)
- Enables future upgrades (MCP/data.gouv enrichment, confidence score, weighting)
