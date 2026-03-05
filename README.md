# mailysleguilloux.bzh

Static website for Maïlys Le Guilloux - Guérisseuse et Kinésiologue.

## Deployment

This site is deployed via Komodo with Git webhooks.

### Infrastructure

- **LXC**: `mailysleguilloux` (192.168.1.XX)
- **Reverse Proxy**: Existing Caddy on 192.168.1.10 (or dedicated proxy LXC)
- **External Access**: Cloudflare Tunnel → mailysleguilloux.bzh

### Files

```
├── site/                 # Website files
│   ├── index.html
│   ├── sitemap.xml
│   ├── robots.txt
│   └── images/          # Add images here
├── docker-compose.yml    # Caddy static server
├── Caddyfile            # Caddy config
└── komodo.toml          # Komodo stack config
```

## Local Development

```bash
cd site
python3 -m http.server 8080
# Open http://localhost:8080
```

## Manual Deployment

```bash
ssh root@192.168.1.XX
cd /opt/mailysleguilloux
git pull
docker compose up -d
```
