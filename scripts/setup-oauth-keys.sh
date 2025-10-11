#!/bin/bash

set -e

echo "🔐 OAuth Keyset Generator for AT Protocol AppView"
echo "=================================================="
echo ""
echo "This script generates OAuth signing keys and DID document for production use."
echo "Keys will be stored in oauth-keyset.json and did.json"
echo ""

# Check for required dependencies
MISSING_DEPS=()
for cmd in openssl xxd jq; do
  if ! command -v $cmd &> /dev/null; then
    MISSING_DEPS+=($cmd)
  fi
done

if [ ${#MISSING_DEPS[@]} -ne 0 ]; then
  echo "❌ Missing required dependencies: ${MISSING_DEPS[*]}"
  echo ""
  echo "Please install them:"
  echo "  Ubuntu/Debian: sudo apt-get install openssl xxd jq"
  echo "  RHEL/CentOS:   sudo yum install openssl vim-common jq"
  echo "  macOS:         brew install jq"
  echo ""
  exit 1
fi


# Get the AppView DID from environment or prompt user
if [ -z "$APPVIEW_DID" ]; then
  read -p "Enter your AppView DID (e.g., did:web:appview.yourdomain.com): " APPVIEW_DID
  if [ -z "$APPVIEW_DID" ]; then
    echo "❌ AppView DID is required"
    exit 1
  fi
fi

echo "🔍 Using AppView DID: $APPVIEW_DID"
echo ""

if [ -f oauth-keyset.json ]; then
  echo "⚠️  oauth-keyset.json already exists!"
  read -p "Overwrite existing keys? (yes/no): " -r
  if [[ ! $REPLY =~ ^[Yy][Ee][Ss]$ ]]; then
    echo "❌ Cancelled. Existing keys preserved."
    exit 1
  fi
fi

if [ -f public/did.json ]; then
  echo "⚠️  public/did.json already exists!"
  read -p "Overwrite existing DID document? (yes/no): " -r
  if [[ ! $REPLY =~ ^[Yy][Ee][Ss]$ ]]; then
    echo "❌ Cancelled. Existing DID document preserved."
    exit 1
  fi
fi

# Generate a unique Key ID (kid) - e.g., timestamp + random hex
KID="$(date +%s)-$(openssl rand -hex 4)"
echo "🔐 Generated Key ID (kid): ${KID}"
echo ""

echo "🔑 Generating ES256 key pair for OAuth..."

# Generate ES256 (P-256) private key
openssl ecparam -name prime256v1 -genkey -noout -out oauth-private.pem 2>/dev/null

# Extract public key
openssl ec -in oauth-private.pem -pubout -out oauth-public.pem 2>/dev/null

# Convert private key to PKCS8 format for easier handling
openssl pkcs8 -topk8 -nocrypt -in oauth-private.pem -out oauth-private-pkcs8.pem 2>/dev/null

# Read the keys (use PKCS8 format for private key)
PRIVATE_KEY=$(cat oauth-private-pkcs8.pem)
PUBLIC_KEY=$(cat oauth-public.pem)

# Extract private key components for JWK format
PRIVATE_D=$(openssl ec -in oauth-private.pem -text -noout 2>/dev/null | grep -A 3 'priv:' | tail -n +2 | tr -d ' \n:' | xxd -r -p | base64 | tr '+/' '-_' | tr -d '=')

# Extract public key coordinates (x, y) from the public key
PUBLIC_KEY_HEX=$(openssl ec -in oauth-private.pem -pubout -text -noout 2>/dev/null | grep -A 5 'pub:' | tail -n +2 | tr -d ' \n:')

# Extract X and Y coordinates (each 32 bytes / 64 hex chars after the 04 prefix)
X_HEX=$(echo $PUBLIC_KEY_HEX | cut -c 3-66)
Y_HEX=$(echo $PUBLIC_KEY_HEX | cut -c 67-130)

# Convert to base64url
X_B64=$(echo $X_HEX | xxd -r -p | base64 | tr '+/' '-_' | tr -d '=')
Y_B64=$(echo $Y_HEX | xxd -r -p | base64 | tr '+/' '-_' | tr -d '=')

# Create OAuth keyset JSON file with both PEM and JWK formats
cat > oauth-keyset.json << EOF
{
  "kid": "${KID}",
  "privateKeyPem": $(echo "$PRIVATE_KEY" | jq -Rs .),
  "publicKeyPem": $(echo "$PUBLIC_KEY" | jq -Rs .),
  "jwk": {
    "kid": "${KID}",
    "kty": "EC",
    "crv": "P-256",
    "x": "${X_B64}",
    "y": "${Y_B64}",
    "d": "${PRIVATE_D}",
    "alg": "ES256",
    "use": "sig"
  }
}
EOF

# Create public directory if it doesn't exist
mkdir -p public

# Extract domain from AppView DID
DOMAIN=$(echo "$APPVIEW_DID" | sed 's/did:web://')

# Create DID document
echo "📄 Generating DID document..."
cat > public/did.json << EOF
{
  "@context": [
    "https://www.w3.org/ns/did/v1",
    "https://w3id.org/security/suites/jws-2020/v1"
  ],
  "id": "${APPVIEW_DID}",
  "verificationMethod": [
    {
      "id": "${APPVIEW_DID}#atproto",
      "type": "JsonWebKey2020",
      "controller": "${APPVIEW_DID}",
      "publicKeyJwk": {
        "kty": "EC",
        "crv": "P-256",
        "x": "${X_B64}",
        "y": "${Y_B64}"
      }
    }
  ],
  "authentication": ["${APPVIEW_DID}#atproto"],
  "assertionMethod": ["${APPVIEW_DID}#atproto"],
  "service": [
    {
      "id": "#bsky_appview",
      "type": "BskyAppView",
      "serviceEndpoint": "https://${DOMAIN}"
    }
  ]
}
EOF

# Create AppView signing key for JWT service
cat > appview-signing-key.json << EOF
{
  "kty": "EC",
  "crv": "P-256",
  "x": "${X_B64}",
  "y": "${Y_B64}",
  "d": "${PRIVATE_D}",
  "kid": "${APPVIEW_DID}#atproto"
}
EOF

echo ""
echo "✅ OAuth keys and DID document generated successfully!"
echo ""
echo "📁 Files created:"
echo "  - oauth-keyset.json (KEEP SECRET! Add to .gitignore)"
echo "  - oauth-private.pem (KEEP SECRET! Add to .gitignore)"
echo "  - oauth-public.pem (public key - safe to share)"
echo "  - public/did.json (DID document - commit this)"
echo "  - appview-signing-key.json (KEEP SECRET! Add to .gitignore)"
echo ""
echo "🔒 Security checklist:"
echo ""
echo "1. Add to .gitignore (if not already added):"
echo "   echo 'oauth-keyset.json' >> .gitignore"
echo "   echo 'oauth-private.pem' >> .gitignore"
echo "   echo 'appview-signing-key.json' >> .gitignore"
echo ""
echo "2. Set environment variables for production:"
echo "   export APPVIEW_DID=${APPVIEW_DID}"
echo "   export OAUTH_KEYSET_PATH=/path/to/oauth-keyset.json"
echo "   Or add to your .env file:"
echo "   APPVIEW_DID=${APPVIEW_DID}"
echo "   OAUTH_KEYSET_PATH=/app/oauth-keyset.json"
echo ""
echo "3. Secure file permissions (on VPS):"
echo "   chmod 600 oauth-keyset.json oauth-private.pem appview-signing-key.json"
echo "   chown appuser:appuser oauth-keyset.json oauth-private.pem appview-signing-key.json"
echo ""
echo "4. For Docker deployment, mount as volumes:"
echo "   volumes:"
echo "     - ./oauth-keyset.json:/app/oauth-keyset.json:ro"
echo "     - ./appview-signing-key.json:/app/appview-signing-key.json:ro"
echo "     - ./public/did.json:/app/public/did.json:ro"
echo ""
echo "5. Verify DID document is accessible:"
echo "   curl https://${DOMAIN}/.well-known/did.json"
echo ""
echo "⚠️  NEVER commit secret files to git!"
echo "⚠️  Store backups securely - losing these keys will invalidate all OAuth sessions!"
echo "✅ DO commit public/did.json to git - this is your public DID document"
echo ""
