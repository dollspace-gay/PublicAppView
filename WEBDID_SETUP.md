# WebDID Setup for AT Protocol AppView

## Quick Setup (3 Steps)

### Step 1: Generate Your WebDID

Run the setup script with your subdomain:

```bash
./scripts/setup-webdid.sh
# Enter your subdomain when prompted: appview.yourdomain.com
```

This creates:
- `public/did.json` - Your DID document (serve this publicly)
- `appview-signing-key.json` - Private key (KEEP SECRET!)
- `appview-private.pem` - Private key PEM format (KEEP SECRET!)
- `appview-public.pem` - Public key (safe to share)

### Step 2: Configure Environment

Add to your `.env` file:

```bash
APPVIEW_DID=did:web:appview.yourdomain.com
```

### Step 3: Deploy with HTTPS

Your subdomain MUST use HTTPS for `did:web` to work.

#### Option A: Deploy on Replit
- Click "Deploy" in Replit
- Point your subdomain DNS to the provided domain
- HTTPS is automatic!

#### Option B: VPS Deployment
```bash
# Point DNS
# appview.yourdomain.com → your-vps-ip

# Install Let's Encrypt
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d appview.yourdomain.com

# Copy files
scp -r public user@vps:/path/to/app/
scp appview-signing-key.json user@vps:/path/to/app/  # SECURE THIS!

# Set environment
export APPVIEW_DID=did:web:appview.yourdomain.com
```

## How It Works

### 1. DID Document Endpoint

Your AppView now serves its DID document at:
```
GET https://appview.yourdomain.com/.well-known/did.json
```

Returns:
```json
{
  "@context": ["https://www.w3.org/ns/did/v1", ...],
  "id": "did:web:appview.yourdomain.com",
  "verificationMethod": [{
    "id": "did:web:appview.yourdomain.com#atproto",
    "type": "JsonWebKey2020",
    "controller": "did:web:appview.yourdomain.com",
    "publicKeyJwk": { ... }
  }],
  "service": [{
    "id": "#appview",
    "type": "AppView",
    "serviceEndpoint": "https://appview.yourdomain.com"
  }]
}
```

### 2. JWT Signing for Feed Generators

When your AppView calls external feed generators, it signs JWTs with your DID:

```javascript
// Your AppView automatically signs requests like this:
{
  "iss": "did:web:appview.yourdomain.com",
  "aud": "did:web:feed-generator.com",
  "sub": "did:web:appview.yourdomain.com",
  "iat": 1234567890,
  "exp": 1234568190
}
```

Feed generators verify this by:
1. Fetching your `/.well-known/did.json`
2. Extracting your public key
3. Verifying the JWT signature

### 3. Service Discovery

Other AT Protocol services can discover your AppView:

```bash
# Resolve your DID
curl https://appview.yourdomain.com/.well-known/did.json

# Get server metadata
curl https://appview.yourdomain.com/xrpc/com.atproto.server.describeServer
```

## Security Notes

### ⚠️ CRITICAL: Keep Private Keys Secret

**NEVER commit these files to git:**
- `appview-signing-key.json`
- `appview-private.pem`
- `.env` (if it contains secrets)

Add to `.gitignore`:
```bash
echo 'appview-signing-key.json' >> .gitignore
echo 'appview-private.pem' >> .gitignore
echo '.env.webdid' >> .gitignore
```

### 🔐 Production Best Practices

1. **Use a secrets manager** (AWS Secrets Manager, HashiCorp Vault, etc.)
2. **Rotate keys periodically** (every 90 days recommended)
3. **Monitor DID document access** (watch for unusual patterns)
4. **Enable HTTPS only** (did:web REQUIRES TLS)
5. **Use DNSSEC** (prevents DNS spoofing)

## What About OAuth?

### You DON'T Need Full OAuth Server

Your AppView is **NOT** an OAuth authorization server (that's what PDSs do).

**What you DO have:**
- ✅ WebDID for identity
- ✅ JWT signing for service-to-service auth
- ✅ Token verification for user sessions (proxied to PDS)

**What you DON'T need:**
- ❌ OAuth authorization endpoints (`/authorize`, `/token`)
- ❌ User credential storage
- ❌ OAuth client registration

The existing authentication in your AppView:
1. **Dashboard auth** - Simple password protection (already implemented)
2. **User sessions** - Tokens from user's PDS (proxied, not managed by you)
3. **Feed generator auth** - Your DID signs JWTs to call external feeds

## DNS Configuration

### Point Subdomain to Your Server

#### Replit Deployment
```
Type: CNAME
Name: appview
Value: your-app.replit.app
TTL: 3600
```

#### VPS Deployment
```
Type: A
Name: appview
Value: 1.2.3.4 (your VPS IP)
TTL: 3600
```

### Verify DNS Propagation
```bash
dig appview.yourdomain.com
nslookup appview.yourdomain.com
```

## Troubleshooting

### DID Document Not Found (404)
- ✅ Check `public/did.json` exists
- ✅ Verify web server serves static files from `public/`
- ✅ Test locally: `curl http://localhost:5000/.well-known/did.json`

### HTTPS Certificate Errors
- ✅ Ensure Let's Encrypt certificate is valid
- ✅ Check certificate includes your subdomain
- ✅ Verify certificate not expired: `openssl s_client -connect appview.yourdomain.com:443`

### JWT Signature Verification Fails
- ✅ Ensure `APPVIEW_DID` environment variable matches your domain
- ✅ Verify public key in `did.json` matches private key
- ✅ Check DID document is accessible from feed generator

### CORS Errors
- ✅ Ensure `Access-Control-Allow-Origin: *` header is set
- ✅ Check web server configuration allows CORS for `/.well-known/*`

## Example: Full Production Setup

```bash
# 1. Generate WebDID
./scripts/setup-webdid.sh
# Enter: appview.example.com

# 2. Configure secrets
export APPVIEW_DID=did:web:appview.example.com
export SESSION_SECRET=$(openssl rand -base64 32)

# 3. Setup DNS
# Point appview.example.com → your-server-ip

# 4. Deploy with HTTPS
docker-compose up -d
certbot --nginx -d appview.example.com

# 5. Verify
curl https://appview.example.com/.well-known/did.json
curl https://appview.example.com/xrpc/com.atproto.server.describeServer
```

## Summary

**Your AppView Setup:**
1. ✅ **WebDID**: `did:web:appview.yourdomain.com`
2. ✅ **DID Document**: Served at `/.well-known/did.json`
3. ✅ **JWT Signing**: Authenticates to feed generators
4. ✅ **Service Discovery**: Other services can find you

**You DON'T need:**
- ❌ Full OAuth 2.0 authorization server
- ❌ User credential management
- ❌ Client registration endpoints

**Your AppView is production-ready when:**
- ✅ HTTPS enabled with valid certificate
- ✅ DID document accessible publicly
- ✅ `APPVIEW_DID` environment variable set
- ✅ Private keys secured
