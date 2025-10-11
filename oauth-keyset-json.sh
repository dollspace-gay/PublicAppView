#!/bin/bash

# A pure Bash script to generate a standalone oauth-keyset.json file
# using a secp256k1 key, suitable for an AT Protocol AppView's internal OAuth.
#
# Dependencies: openssl, jq, xxd

set -e

echo "🔐 OAuth Keyset Generator"
echo "==========================="
echo ""

# --- Dependency Check ---
for cmd in openssl jq xxd; do
  if ! command -v $cmd &> /dev/null; then
    echo "❌ Missing required dependency: $cmd"
    echo "Please install it and try again."
    exit 1
  fi
done

# --- Key Generation ---
echo "🔑 Generating secp256k1 key pair..."
# Generate a secp256k1 private key
openssl ecparam -name secp256k1 -genkey -noout -out private.pem

# Generate the corresponding public key
openssl ec -in private.pem -pubout -out public.pem 2>/dev/null

# Read PEM file contents into variables
PRIVATE_KEY_PEM=$(cat private.pem)
PUBLIC_KEY_PEM=$(cat public.pem)

echo "⚙️  Formatting key into JWK format..."
# Extract all key components in hex format
KEY_COMPONENTS_HEX=$(openssl ec -in private.pem -text -noout)

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
jq -n \
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
      crv: "secp256k1",
      alg: "ES256K",
      use: "sig",
      d: $d,
      x: $x,
      y: $y
    }
  }' > oauth-keyset.json

# --- Cleanup ---
rm private.pem public.pem

echo ""
echo "✅ Success! oauth-keyset.json generated."
echo ""