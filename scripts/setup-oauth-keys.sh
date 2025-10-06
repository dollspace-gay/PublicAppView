#!/bin/bash

set -e

echo "🔐 OAuth Keyset Generator for AT Protocol AppView"
echo "=================================================="
echo ""
echo "This script generates OAuth signing keys for production use."
echo "Keys will be stored in oauth-keyset.json"
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


if [ -f oauth-keyset.json ]; then
  echo "⚠️  oauth-keyset.json already exists!"
  read -p "Overwrite existing keys? (yes/no): " -r
  if [[ ! $REPLY =~ ^[Yy][Ee][Ss]$ ]]; then
    echo "❌ Cancelled. Existing keys preserved."
    exit 1
  fi
fi

echo "🔑 Generating ES256K key pair for OAuth..."

# Generate ES256K private key (using secp256k1 curve)
openssl ecparam -name secp256k1 -genkey -noout -out oauth-private.pem 2>/dev/null

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
  "privateKeyPem": $(echo "$PRIVATE_KEY" | jq -Rs .),
  "publicKeyPem": $(echo "$PUBLIC_KEY" | jq -Rs .),
  "jwk": {
    "kty": "EC",
    "crv": "secp256k1",
    "x": "${X_B64}",
    "y": "${Y_B64}",
    "d": "${PRIVATE_D}",
    "alg": "ES256K",
    "use": "sig"
  }
}
EOF

echo ""
echo "✅ OAuth keys generated successfully!"
echo ""
echo "📁 Files created:"
echo "  - oauth-keyset.json (KEEP SECRET! Add to .gitignore)"
echo "  - oauth-private.pem (KEEP SECRET! Add to .gitignore)"
echo "  - oauth-public.pem (public key - safe to share)"
echo ""
echo "🔒 Security checklist:"
echo ""
echo "1. Add to .gitignore (if not already added):"
echo "   echo 'oauth-keyset.json' >> .gitignore"
echo "   echo 'oauth-private.pem' >> .gitignore"
echo ""
echo "2. Set environment variable for production:"
echo "   export OAUTH_KEYSET_PATH=/path/to/oauth-keyset.json"
echo "   Or add to your .env file:"
echo "   OAUTH_KEYSET_PATH=/app/oauth-keyset.json"
echo ""
echo "3. Secure file permissions (on VPS):"
echo "   chmod 600 oauth-keyset.json oauth-private.pem"
echo "   chown appuser:appuser oauth-keyset.json oauth-private.pem"
echo ""
echo "4. For Docker deployment, mount as a volume:"
echo "   volumes:"
echo "     - ./oauth-keyset.json:/app/oauth-keyset.json:ro"
echo ""
echo "⚠️  NEVER commit these files to git!"
echo "⚠️  Store backups securely - losing these keys will invalidate all OAuth sessions!"
echo ""
