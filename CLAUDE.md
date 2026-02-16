# CLAUDE.md - Konto Project Context

## What is Konto?

Personal accounting & patrimoine tracker - full-stack app for managing finances, invoices, transactions, and bank connections.

## Tech Stack

| Layer | Tech |
|-------|------|
| Backend | Hono (Node.js) + TypeScript |
| Database | SQLite (libsql/client, WAL mode) |
| Frontend | React 18 + TypeScript + Vite |
| Auth | Clerk |
| Integrations | Google Drive, Powens (Banking), Coinbase, Smoobu |

## Infrastructure

### Proxmox VM Setup

**Current VM:** openclaw-vm (VMID 133)
- **IP:** 192.168.0.133
- **Public Access:** via Proxmox host at 65.108.14.251
- **SSH:** `ssh openclaw-vm` (requires ProxyJump through Proxmox)

### Proxmox Host Access

```bash
# SSH to Proxmox host
ssh jndoye@65.108.14.251
# Password: Tizen2023

# Or use alias
ssh proxmox
```

### Port Forwarding Architecture

```
Internet → Proxmox Host (65.108.14.251)
  ├── Port 443 → VM .133 (openclaw-vm) [DIRECT - for Cloudflare]
  └── Port 8080 → VM .133:443 (direct, legacy)
```

**Note:** Port 443 forwards directly to openclaw-vm (.133) because it has the Cloudflare Origin Certificate. VM .107 (proxy) is not used for external access as it only has self-signed certificates.

### Domain Configuration

**Primary Domain:** `angelstreet.io`
- **Managed by:** Cloudflare (DNS + SSL/TLS)
- **Nameservers:** becky.ns.cloudflare.com, dilbert.ns.cloudflare.com
- **SSL Mode:** Full (NOT Full Strict)
- **Origin Certificate:** Installed on openclaw-vm (.133)

**Cloudflare DNS Configuration (REQUIRED):**
- Each subdomain needs an A record pointing to: `65.108.14.251`
- Proxy status: Enabled (orange cloud)
- Records needed:
  - `konto.angelstreet.io` → 65.108.14.251 (proxied)
  - `kozy.angelstreet.io` → 65.108.14.251 (proxied)
  - `pikaboard.angelstreet.io` → 65.108.14.251 (proxied)
  - `ezplanner.angelstreet.io` → 65.108.14.251 (proxied)

**Subdomains:**
- `konto.angelstreet.io` → Konto app (port 3004 frontend, 5004 backend)
- `kozy.angelstreet.io` → Kozy (port 3002)
- `pikaboard.angelstreet.io` → PikaBoard (port 3001 frontend, 5001 backend)
- `ezplanner.angelstreet.io` → EZPlanner (port 3005 frontend, 5005 backend)

### Nginx Configuration

**On VM .133 (openclaw-vm):**
- Port 443 with Cloudflare Origin Certificate
- Config: `/etc/nginx/sites-enabled/angelstreet`
- SSL Cert: `/etc/ssl/cloudflare/angelstreet.crt`
- SSL Key: `/etc/ssl/cloudflare/angelstreet.key`

**On VM .107 (proxy):**
- NOT currently used for external angelstreet.io access (has self-signed cert)
- Config: `/etc/nginx/sites-enabled/angelstreet` (disabled)
- virtualpytest config also disabled temporarily
- Backups: `/tmp/nginx-backup-*.tar.gz`

### SSH to VMs

All VMs accessible via ProxyJump through Proxmox host:

```bash
ssh storage      # 192.168.0.102 - MinIO + Redis
ssh database     # 192.168.0.101 - PostgreSQL
ssh server       # 192.168.0.103 - Flask backend
ssh frontend     # 192.168.0.105 - React frontend
ssh monitoring   # 192.168.0.106 - Grafana
ssh proxy        # 192.168.0.107 - Nginx reverse proxy
ssh host         # 192.168.0.108 - General purpose
ssh openclaw-vm  # 192.168.0.133 - OpenClaw + PikaBoard + Konto
```

### Managing Port Forwarding

To modify port forwarding rules on Proxmox host:

```bash
# Connect to Proxmox
ssh jndoye@65.108.14.251

# List current NAT rules
echo 'Tizen2023' | sudo -S iptables -t nat -L PREROUTING -n -v

# Add new port forwarding (example)
echo 'Tizen2023' | sudo -S iptables -t nat -A PREROUTING -i enp41s0 -p tcp --dport PORT -j DNAT --to 192.168.0.133:PORT

# Save rules
echo 'Tizen2023' | sudo -S iptables-save > /etc/iptables/rules.v4
```

## Google OAuth Setup

**Redirect URI:** `https://konto.angelstreet.io/api/drive-callback`

**OAuth Client:**
- Type: Web application
- Client ID: `953807493269-l41h9h288jet5ivchb3h3hj802mhf5s9.apps.googleusercontent.com`
- Scopes: `https://www.googleapis.com/auth/drive.readonly`

## Development Workflow

**Local Development:**
```bash
cd /home/jndoye/shared/projects/konto

# Backend
cd backend
npm run dev  # Port 5004

# Frontend
cd frontend
npm run dev  # Port 3004
```

**Production URLs:**
- IP-based: `https://65.108.14.251:8080/konto/`
- Domain: `https://konto.angelstreet.io`
- Vercel: `https://kompta-frontend.vercel.app`

## Environment Variables

Backend `.env` location: `/home/jndoye/shared/projects/konto/backend/.env`

Key variables:
- `GOOGLE_CLIENT_ID` - Google OAuth client ID
- `GOOGLE_CLIENT_SECRET` - Google OAuth secret
- `GOOGLE_DRIVE_REDIRECT_URI` - OAuth redirect URL
- `CLERK_SECRET_KEY` - Clerk auth key
- `POWENS_CLIENT_ID` - Banking API credentials

## PM2 Process Management

```bash
# List Konto processes
pm2 list | grep konto

# Restart from within openclaw-vm
pm2 restart konto-backend
pm2 restart konto-frontend

# Restart remotely from Proxmox
ssh proxmox "ssh jndoye@192.168.0.133 'npx pm2 restart konto-frontend'"

# View logs
pm2 logs konto-backend
```

## Recent Configuration Changes (2026-02-16)

### Vite allowedHosts Configuration
Added `allowedHosts` to `/home/jndoye/shared/projects/konto/frontend/vite.config.ts`:
```typescript
server: {
  allowedHosts: [
    'konto.angelstreet.io',
    '.angelstreet.io',
    'localhost',
    '65.108.14.251',
  ],
  // ... rest of config
}
```

This prevents Vite from blocking requests with the angelstreet.io Host header.

### Port Forwarding Changes
Changed port 443 forwarding on Proxmox host:
- **Before:** Port 443 → VM .107 (proxy with self-signed cert)
- **After:** Port 443 → VM .133 (openclaw-vm with Cloudflare Origin Certificate)

This change was necessary because Cloudflare's "Full" SSL mode requires a valid certificate, and only openclaw-vm has the Cloudflare Origin Certificate.

## Troubleshooting

### Port Forwarding Issues

1. Check if port is forwarded correctly:
   ```bash
   ssh proxmox "echo 'Tizen2023' | sudo -S iptables -t nat -L PREROUTING -n -v | grep PORT"
   ```

2. Test from inside VM:
   ```bash
   ssh openclaw-vm "curl -I http://localhost:PORT"
   ```

3. **UPDATED:** Port 443 now forwards directly to VM .133 (openclaw-vm)

### Cloudflare Issues

**DNS Configuration (CRITICAL):**
- Each subdomain MUST have an A record in Cloudflare pointing to `65.108.14.251`
- Proxy status must be ENABLED (orange cloud)
- Check DNS: `nslookup konto.angelstreet.io` (should return Cloudflare IPs)

**SSL/TLS Settings:**
- Mode: "Full" (NOT "Full Strict")
- Origin Certificate installed on VM .133: ✓
- Check: Cloudflare → SSL/TLS → Overview → Encryption mode

**Debugging 522 Errors:**
```bash
# Check if Cloudflare requests reach openclaw-vm
ssh openclaw-vm "sudo tail -f /var/log/nginx/access.log | grep cloudflare"

# Test origin connectivity
curl -I -k https://65.108.14.251:443 -H 'Host: konto.angelstreet.io'
```

### Nginx Issues

- Test config: `ssh openclaw-vm "sudo nginx -t"`
- Reload: `ssh openclaw-vm "sudo systemctl reload nginx"`
- Check logs: `ssh openclaw-vm "sudo tail -f /var/log/nginx/error.log"`

---

**Quick reference for infrastructure and deployment operations**
