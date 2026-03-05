# Deployment Guide - mailysleguilloux.bzh

## Architecture

```
Internet
    │
    ▼
Cloudflare Tunnel (cloudflared)
    │
    ▼ mailysleguilloux.bzh
Caddy Reverse Proxy (192.168.1.10)
    │
    ▼ http://192.168.1.14:80
LXC: mailysleguilloux (192.168.1.14)
    └── Docker: Caddy serving static files
```

---

## 1. Create the LXC

### Via Proxmox UI

1. Create CT with these settings:
   - **CT ID**: 114 (or next available)
   - **Hostname**: `mailysleguilloux`
   - **Template**: `debian-12-standard`
   - **Disk**: 4 GB
   - **CPU**: 1 core
   - **Memory**: 512 MB
   - **Network**: 
     - Bridge: `vmbr0`
     - IPv4: `192.168.1.14/24`
     - Gateway: `192.168.1.1`

2. Enable features for Docker:
   ```bash
   # On Proxmox host
   pct set 114 --features nesting=1
   ```

### Via CLI (on Proxmox host)

```bash
# Download template if needed
pveam download local debian-12-standard_12.2-1_amd64.tar.zst

# Create container
pct create 114 local:vztmpl/debian-12-standard_12.2-1_amd64.tar.zst \
  --hostname mailysleguilloux \
  --memory 512 \
  --cores 1 \
  --rootfs local-lvm:4 \
  --net0 name=eth0,bridge=vmbr0,ip=192.168.1.14/24,gw=192.168.1.1 \
  --features nesting=1 \
  --unprivileged 1 \
  --start 1

# Start container
pct start 114
```

---

## 2. Setup the LXC

```bash
# Enter the container
pct enter 114

# Update system
apt update && apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com | sh
apt install -y docker-compose-plugin git

# Create directory structure
mkdir -p /opt/mailysleguilloux
cd /opt/mailysleguilloux

# Clone the repository
git clone https://github.com/YOUR_USERNAME/mailysleguilloux.bzh.git .

# Download images (run once)
chmod +x scripts/download-images.sh
./scripts/download-images.sh

# Start the stack
docker compose up -d

# Verify it's running
curl -s localhost | head -20
```

---

## 3. Add to Komodo

### Add the server

In Komodo UI or via CLI:

```bash
komodo server create \
  --name mailysleguilloux \
  --address 192.168.1.14 \
  --port 22 \
  --username root
```

### Deploy the stack

```bash
komodo stack deploy \
  --name mailysleguilloux \
  --server mailysleguilloux \
  --repo https://github.com/YOUR_USERNAME/mailysleguilloux.bzh.git \
  --branch main \
  --run-directory /opt/mailysleguilloux \
  --webhook-enabled
```

Or import from `komodo.toml` in the repo.

---

## 4. Configure Reverse Proxy (Existing Caddy)

Add to your main Caddy configuration (on 192.168.1.10 or your proxy LXC):

### Option A: Direct file in Caddyfile

```caddyfile
# mailysleguilloux.bzh - Static site
mailysleguilloux.bzh {
    reverse_proxy 192.168.1.14:80
    
    encode gzip zstd
    
    header {
        X-Content-Type-Options "nosniff"
        X-Frame-Options "SAMEORIGIN"
        Strict-Transport-Security "max-age=31536000; includeSubDomains"
    }
}
```

### Option B: Separate config file (if using conf.d pattern)

Create `/opt/caddy/conf.d/mailysleguilloux.caddyfile`:

```caddyfile
mailysleguilloux.bzh {
    reverse_proxy 192.168.1.14:80
    encode gzip zstd
}
```

Then reload Caddy:
```bash
docker exec caddy caddy reload --config /etc/caddy/Caddyfile
```

---

## 5. Configure Cloudflare Tunnel

### Via Cloudflare Dashboard (Zero Trust)

1. Go to **Zero Trust** → **Networks** → **Tunnels**
2. Select your existing tunnel
3. Click **Configure** → **Public Hostname**
4. Add new hostname:
   - **Subdomain**: (leave empty for apex)
   - **Domain**: `mailysleguilloux.bzh`
   - **Service**: `http://192.168.1.10:80` (your Caddy reverse proxy)

### Via cloudflared config file

Add to your `config.yml`:

```yaml
ingress:
  # ... existing rules ...
  
  - hostname: mailysleguilloux.bzh
    service: http://192.168.1.10:80
  
  # Catch-all (must be last)
  - service: http_status:404
```

Then restart cloudflared:
```bash
systemctl restart cloudflared
# or
docker restart cloudflared
```

---

## 6. DNS Configuration

In Cloudflare DNS for `mailysleguilloux.bzh`:

| Type | Name | Content | Proxy |
|------|------|---------|-------|
| CNAME | @ | `<tunnel-id>.cfargotunnel.com` | Proxied ✓ |
| CNAME | www | `mailysleguilloux.bzh` | Proxied ✓ |

The tunnel ID is shown in your Cloudflare Tunnel dashboard.

---

## 7. Verify Deployment

```bash
# Test locally on the LXC
curl -I http://192.168.1.14

# Test via reverse proxy
curl -I http://192.168.1.10 -H "Host: mailysleguilloux.bzh"

# Test externally (after DNS propagation)
curl -I https://mailysleguilloux.bzh
```

Expected response:
```
HTTP/2 200
content-type: text/html; charset=utf-8
```

---

## 8. Setup Webhook (Auto-deploy on Git Push)

### Get webhook URL from Komodo

```bash
komodo stack info mailysleguilloux
# Look for webhook_url
```

### Add to GitHub

1. Go to repo **Settings** → **Webhooks**
2. Add webhook:
   - **Payload URL**: `https://your-komodo-url/api/webhook/stack/mailysleguilloux`
   - **Content type**: `application/json`
   - **Secret**: (from Komodo if configured)
   - **Events**: Just the `push` event

Now any push to `main` will auto-deploy!

---

## Maintenance

### Manual deploy
```bash
ssh root@192.168.1.14
cd /opt/mailysleguilloux
git pull
docker compose up -d
```

### View logs
```bash
docker logs -f mailysleguilloux-web
```

### Update Caddy image
```bash
docker compose pull
docker compose up -d
```

---

## Troubleshooting

### Site not accessible
```bash
# Check container is running
docker ps

# Check Caddy logs
docker logs mailysleguilloux-web

# Check reverse proxy can reach it
curl -v http://192.168.1.14
```

### DNS not resolving
```bash
# Check DNS propagation
dig mailysleguilloux.bzh

# Verify Cloudflare tunnel
cloudflared tunnel info <tunnel-name>
```

### 502 Bad Gateway
- Verify LXC IP is correct in reverse proxy config
- Check firewall rules allow traffic on port 80
- Ensure Docker container is running
