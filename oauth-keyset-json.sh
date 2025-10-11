#!/bin/bash

# A pure Bash script to generate a standalone oauth-keyset.json file
# using a P-256 key (ES256), suitable for an AT Protocol AppView's internal OAuth.
#
# Dependencies: openssl, jq, xxd

set -e

echo "🔐 OAuth Keyset Generator"
echo "==========================="
echo ""

# --- Dependency Check ---
for cmd in openssl xxd; do
  if ! command -v $cmd &> /dev/null; then
    echo "❌ Missing required dependency: $cmd"
    echo "Please install it and try again."
    exit 1
  fi
done

# Check for jq (local or system)
if ! command -v jq &> /dev/null && ! [ -f "./jq" ]; then
  echo "❌ Missing required dependency: jq"
  echo "Please install it and try again."
  exit 1
fi

# Use local jq if available
JQ_CMD="jq"
if [ -f "./jq" ]; then
  JQ_CMD="./jq"
fi

# --- Key Generation ---
echo "🔑 Generating P-256 key pair for ES256..."
# Generate a P-256 private key (required for ES256)
openssl ecparam -name prime256v1 -genkey -noout -out private_ec.pem

# Convert EC private key to PKCS#8 format (required by JoseKey.fromImportable)
openssl pkcs8 -topk8 -inform PEM -outform PEM -nocrypt -in private_ec.pem -out private.pem

# Generate the corresponding public key
openssl ec -in private_ec.pem -pubout -out public.pem 2>/dev/null

# Read PEM file contents into variables
PRIVATE_KEY_PEM=$(cat private.pem)
PUBLIC_KEY_PEM=$(cat public.pem)

echo "⚙️  Formatting key into JWK format..."
# Extract all key components in hex format (use original EC key for component extraction)
KEY_COMPONENTS_HEX=$(openssl ec -in private_ec.pem -text -noout)

# Isolate and clean up each component
PRIV_HEX=$(echo "$KEY_COMPONENTS_HEX" | grep priv -A 3 | tail -n +2 | tr -d ' \n:')
PUB_HEX=$(echo "$KEY_COMPONENTS_HEX" | grep pub -A 5 | tail -n +2 | tr -d ' \n:')
X_HEX=$(echo "$PUB_HEX" | cut -c 3-66)
Y_HEX=$(echo "$PUB_HEX" | cut -c 67-130)

# Convert hex components to base64url for the JWK
D_B64URL=$(echo -n "$PRIV_HEX" | xxd -r -p | base64 | tr '/+' '_-' | tr -d '=')
X_B64URL=$(echo -n "$X_HEX" | xxd -r -p | base64 | tr '/+' '_-' | tr -d '=')
Y_B64URL=$(echo -n "$Y_HEX" | xxd -r -p | base64 | tr '/+' '_-' | tr -d '=')

# Generate a unique Key ID (kid)
KID="$(date +%s)-$(openssl rand -hex 4)"

# --- File Creation ---
echo "📄 Creating oauth-keyset.json file..."
$JQ_CMD -n \
  --arg kid "$KID" \
  --arg pkpem "$PRIVATE_KEY_PEM" \
  --arg pubpem "$PUBLIC_KEY_PEM" \
  --arg d "$D_B64URL" \
  --arg x "$X_B64URL" \
  --arg y "$Y_B64URL" \
  '{
    kid: $kid,
    privateKeyPem: $pkpem,
    publicKeyPem: $pubpem,
    jwk: {
      kid: $kid,
      kty: "EC",
      crv: "P-256",
      alg: "ES256",
      use: "sig",
      d: $d,
      x: $x,
      y: $y
    }
  }' > oauth-keyset.json

# --- Cleanup ---
rm private.pem private_ec.pem public.pem

echo ""
echo "✅ Success! oauth-keyset.json generated."
echo ""