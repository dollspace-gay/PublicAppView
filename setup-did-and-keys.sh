#!/bin/bash

# A pure Bash script to generate AT Protocol compatible secp256k1 keys.
# No Node.js, no npm, no bullshit.
#
# Dependencies: openssl, jq, xxd, bs58

set -e

echo "🔐 Pure Bash AT Protocol Key Generator"
echo "========================================"
echo ""

# --- Dependency Check ---
for cmd in openssl jq xxd bs58; do
  if ! command -v $cmd &> /dev/null; then
    echo "❌ Missing required dependency: $cmd"
    echo "Please install it and try again."
    exit 1
  fi
done

# --- User Input ---
read -p "Enter your AppView DID (e.g., did:web:appview.yourdomain.com): " APPVIEW_DID
if [[ ! "$APPVIEW_DID" =~ ^did:web:.+ ]]; then
  echo "❌ Invalid DID format. It must start with 'did:web:'"
  exit 1
fi

DOMAIN=$(echo "$APPVIEW_DID" | sed 's/did:web://')
echo "✅ Using DID: $APPVIEW_DID"
echo ""

# --- Key Generation ---
echo "🔑 Generating secp256k1 key pair..."
# 1. Generate a secp256k1 private key
openssl ecparam -name secp256k1 -genkey -noout -out appview-private.pem

# --- Public Key Formatting for did.json ---
echo "📄 Formatting public key for DID document..."
# 2. Extract the raw 65-byte uncompressed public key (0x04 prefix + X + Y)
RAW_PUBKEY=$(openssl ec -in appview-private.pem -pubout -outform DER | tail -c 65)

# 3. Prepend the multicodec prefix for secp256k1-pub (0xe701)
#    We use printf to create the raw bytes.
PREFIXED_KEY=$(printf '\xe7\x01' && echo -n "$RAW_PUBKEY")

# 4. Encode the result with Base58BTC to create the final multibase string
PUBLIC_KEY_MULTIBASE=$(echo -n "$PREFIXED_KEY" | bs58)

# --- Private Key Formatting for JWK ---
echo "⚙️  Formatting private key for application use (JWK)..."
# 5. Extract all key components in hex format
KEY_COMPONENTS_HEX=$(openssl ec -in appview-private.pem -text -noout)

# 6. Isolate and clean up each component
PRIV_HEX=$(echo "$KEY_COMPONENTS_HEX" | grep priv -A 3 | tail -n +2 | tr -d ' \n:')
PUB_HEX=$(echo "$KEY_COMPONENTS_HEX" | grep pub -A 5 | tail -n +2 | tr -d ' \n:')
X_HEX=$(echo $PUB_HEX | cut -c 3-66)
Y_HEX=$(echo $PUB_HEX | cut -c 67-130)

# 7. Convert hex components to base64url for the JWK
#    xxd -r -p converts hex to binary, which is then piped to base64
D_B64URL=$(echo -n $PRIV_HEX | xxd -r -p | base64 | tr '/+' '_-' | tr -d '=')
X_B64URL=$(echo -n $X_HEX | xxd -r -p | base64 | tr '/+' '_-' | tr -d '=')
Y_B64URL=$(echo -n $Y_HEX | xxd -r -p | base64 | tr '/+' '_-' | tr -d '=')

# --- File Creation ---
mkdir -p public

# 8. Create the did.json file using jq
jq -n \
  --arg id "$APPVIEW_DID" \
  --arg domain "$DOMAIN" \
  --arg pubkey "$PUBLIC_KEY_MULTIBASE" \
  '{
    "@context": [
      "https://www.w3.org/ns/did/v1",
      "https://w3id.org/security/multikey/v1",
    ],
    id: $id,
    alsoKnownAs: ["at://\($domain)"],
    verificationMethod: [
      {
        id: "\($id)#atproto",
        type: "Multikey",
        controller: $id,
        publicKeyMultibase: $pubkey
      }
    ],
    service: [
      {
        id: "#bsky_notif",
        type: "BskyNotificationServic",
        serviceEndpoint: "https://\($domain)"
      }
	  {
        id: "#bsky_appview",
        type: "BskyAppView",
        serviceEndpoint: "https://\($domain)"
      }
    ]
  }' > public/did.json

# 9. Create the private key file (appview-signing-key.json) using jq
jq -n \
  --arg d "$D_B64URL" \
  --arg x "$X_B64URL" \
  --arg y "$Y_B64URL" \
  '{
    kty: "EC",
    crv: "secp256k1",
    d: $d,
    x: $x,
    y: $y
  }' > appview-signing-key.json

# 10. Keep the PEM file for JWT signing (don't remove it)

echo ""
echo "✅ Success! All files generated."
echo ""
echo "📁 Files created:"
echo "  - appview-signing-key.json (PRIVATE KEY - KEEP SECRET!)"
echo "  - appview-private.pem      (PRIVATE KEY PEM - KEEP SECRET!)"
echo "  - public/did.json          (Public DID Document - commit this)"
echo ""
echo "🔒 Security & Deployment Checklist:"
echo "-------------------------------------"
echo "1. Add to .gitignore: echo 'appview-signing-key.json' >> .gitignore"
echo "2. Add to .gitignore: echo 'appview-private.pem' >> .gitignore"
echo "3. Set ENV Var: export APPVIEW_SIGNING_KEY_PATH=/path/to/appview-signing-key.json"
echo "4. Secure permissions: chmod 600 appview-signing-key.json appview-private.pem"
echo "5. Deploy public/did.json to https://${DOMAIN}/.well-known/did.json"
echo "6. Verify deployment: curl https://${DOMAIN}/.well-known/did.json"
echo ""