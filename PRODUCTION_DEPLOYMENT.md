# Production Deployment Guide

This guide covers deploying the AT Protocol AppView to production with proper OAuth key management.

## OAuth Keys for Production

In production, OAuth signing keys should be stored as files on the server, not in the database. This provides better security and allows keys to persist across container restarts without database dependencies.

### Generating OAuth Keys on Your VPS

1. **SSH into your VPS:**
   ```bash
   ssh user@your-vps-ip
   cd /path/to/appview
   ```

2. **Run the OAuth key generation script:**
   ```bash
   ./scripts/setup-oauth-keys.sh
   ```

   This will create:
   - `oauth-keyset.json` - Main keyset file (KEEP SECRET!)
   - `oauth-private.pem` - Private key PEM format (KEEP SECRET!)
   - `oauth-public.pem` - Public key (safe to share)

3. **Secure the key files:**
   ```bash
   # Set restrictive permissions
   chmod 600 oauth-keyset.json oauth-private.pem
   
   # Set ownership to your app user
   chown appuser:appuser oauth-keyset.json oauth-private.pem
   ```

4. **Verify the keyset file format:**
   ```bash
   cat oauth-keyset.json | jq .
   ```

   Should show:
   ```json
   {
     "privateKeyPem": "-----BEGIN EC PRIVATE KEY-----\n...",
     "publicKeyPem": "-----BEGIN PUBLIC KEY-----\n...",
     "jwk": {
       "kty": "EC",
       "crv": "P-256",
       ...
     }
   }
   ```

### Docker Compose Setup

Add the following to your `docker-compose.yml`:

```yaml
version: '3.8'

services:
  appview:
    image: your-appview-image:latest
    environment:
      # OAuth Configuration
      - OAUTH_KEYSET_PATH=/app/oauth-keyset.json
      
      # Other required variables
      - DATABASE_URL=postgresql://...
      - SESSION_SECRET=your-session-secret
      - APPVIEW_DID=did:web:appview.dollspace.gay
      
      # Optional: Control firehose ingestion
      - FIREHOSE_ENABLED=true
      - DATA_RETENTION_DAYS=90
      - BACKFILL_DAYS=30
    
    volumes:
      # Mount OAuth keys as read-only
      - ./oauth-keyset.json:/app/oauth-keyset.json:ro
      
      # Mount WebDID signing key if using AppView JWT features
      - ./appview-signing-key.json:/app/appview-signing-key.json:ro
    
    ports:
      - "5000:5000"
    
    restart: unless-stopped
```

### Environment Variable Reference

#### Required Variables

- `DATABASE_URL` - PostgreSQL connection string
- `SESSION_SECRET` - Encryption key for OAuth tokens (min 32 chars)
- `APPVIEW_DID` - WebDID identifier (e.g., `did:web:appview.dollspace.gay`)

#### OAuth Configuration

- `OAUTH_KEYSET_PATH` - Path to oauth-keyset.json file
  - **Production:** `/app/oauth-keyset.json` (mounted via Docker volume)
  - **Development:** Not set (uses database storage)

#### Optional Configuration

- `FIREHOSE_ENABLED` - Enable/disable firehose ingestion (default: `true`)
  - Set to `false` for testing/debugging without network load
  
- `DATA_RETENTION_DAYS` - Days to retain data (default: `0` = keep forever)
  - Example: `90` for 90-day retention
  
- `BACKFILL_DAYS` - Days of historical data to backfill (default: `0` = disabled)
  - Example: `30` to backfill last 30 days

### File Structure on VPS

```
/path/to/appview/
├── docker-compose.yml
├── oauth-keyset.json          # OAuth signing keys (SECRET!)
├── oauth-private.pem           # OAuth private key (SECRET!)
├── oauth-public.pem            # OAuth public key
├── appview-signing-key.json    # AppView JWT signing key (SECRET!)
├── appview-private.pem         # AppView private key (SECRET!)
├── public/
│   └── did.json                # Public DID document
└── .env                        # Environment variables (SECRET!)
```

### Security Best Practices

1. **Never commit secrets to git:**
   - All `*.pem` files are in `.gitignore`
   - All `*-key.json` files are in `.gitignore`
   - Verify: `git status` should not show these files

2. **Use strict file permissions:**
   ```bash
   chmod 600 oauth-keyset.json oauth-private.pem appview-signing-key.json
   ```

3. **Backup your keys securely:**
   ```bash
   # Create encrypted backup
   tar czf keys-backup-$(date +%Y%m%d).tar.gz oauth-keyset.json appview-signing-key.json
   gpg --symmetric keys-backup-*.tar.gz
   rm keys-backup-*.tar.gz  # Keep only encrypted version
   ```

4. **Key rotation (advanced):**
   - Generate new keys using the setup scripts
   - Update mounted volumes in docker-compose.yml
   - Restart services: `docker-compose restart appview`
   - Note: Existing OAuth sessions will be invalidated

### Deployment Checklist

- [ ] Generate OAuth keys using `./scripts/setup-oauth-keys.sh`
- [ ] Set file permissions: `chmod 600 oauth-keyset.json`
- [ ] Update `docker-compose.yml` with `OAUTH_KEYSET_PATH`
- [ ] Mount oauth-keyset.json as read-only volume
- [ ] Set all required environment variables
- [ ] Verify `.gitignore` includes all secret files
- [ ] Create encrypted backup of keys
- [ ] Test OAuth login flow after deployment
- [ ] Monitor logs for "Loading keyset from file" confirmation

### Verifying Production Setup

After deployment, check the logs:

```bash
docker-compose logs appview | grep OAUTH
```

You should see:
```
[OAUTH] Loading keyset from file: /app/oauth-keyset.json
[OAUTH] Loaded keyset from file successfully
[OAUTH] Client initialized successfully
```

### Development vs Production

| Aspect | Development (Replit) | Production (VPS) |
|--------|---------------------|------------------|
| OAuth Keys | Database storage | File system |
| Key Generation | Automatic on first run | Manual via script |
| Key Persistence | Database (oauth_keyset table) | oauth-keyset.json |
| Configuration | No OAUTH_KEYSET_PATH | OAUTH_KEYSET_PATH set |
| Security | Moderate (encrypted in DB) | High (file permissions) |

### Troubleshooting

**Error: "Invalid oauth-keyset.json: missing privateKeyPem"**
- Solution: Re-run `./scripts/setup-oauth-keys.sh`

**Error: "ENOENT: no such file or directory"**
- Solution: Verify volume mount in docker-compose.yml
- Check file exists: `ls -la oauth-keyset.json`

**OAuth login fails after restart**
- Check logs for keyset loading confirmation
- Verify OAUTH_KEYSET_PATH environment variable is set
- Ensure volume mount is correct in docker-compose.yml

**Want to switch from DB to file storage?**
1. Generate keys on VPS: `./scripts/setup-oauth-keys.sh`
2. Set `OAUTH_KEYSET_PATH=/app/oauth-keyset.json`
3. Mount file in docker-compose.yml
4. Restart: `docker-compose restart appview`
5. Database keys will be ignored (not deleted)
