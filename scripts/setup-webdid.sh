#!/bin/bash

# WebDID Setup Script for AT Protocol AppView
# This generates a keypair and DID document for your AppView

set -e

echo "🔑 AT Protocol AppView - WebDID Setup"
echo "======================================"
echo ""

# Get the domain from user
read -p "Enter your subdomain (e.g., appview.yourdomain.com): " DOMAIN

if [ -z "$DOMAIN" ]; then
  echo "❌ Domain is required"
  exit 1
fi

echo ""
echo "📝 Generating ES256 keypair..."

# Generate private key (ES256 = P-256 curve)
openssl ecparam -name prime256v1 -genkey -noout -out appview-private.pem

# Extract public key
openssl ec -in appview-private.pem -pubout -out appview-public.pem

# Convert private key to JWK format for JWT signing
PRIVATE_D=$(openssl ec -in appview-private.pem -noout -text 2>/dev/null | grep -A 3 'priv:' | tail -n +2 | tr -d ':\n ' | xxd -r -p | base64 | tr '+/' '-_' | tr -d '=')

# Extract public key coordinates
PUBLIC_KEY_HEX=$(openssl ec -in appview-public.pem -pubin -text -noout 2>/dev/null | grep -A 5 'pub:' | tail -n +2 | tr -d ':\n ')
X_HEX=$(echo $PUBLIC_KEY_HEX | cut -c 5-68)
Y_HEX=$(echo $PUBLIC_KEY_HEX | cut -c 69-132)

# Convert to base64url
X_B64=$(echo $X_HEX | xxd -r -p | base64 | tr '+/' '-_' | tr -d '=')
Y_B64=$(echo $Y_HEX | xxd -r -p | base64 | tr '+/' '-_' | tr -d '=')

# Create DID document
cat > public/did.json << EOF
{
  "@context": [
    "https://www.w3.org/ns/did/v1",
    "https://w3id.org/security/suites/jws-2020/v1"
  ],
  "id": "did:web:${DOMAIN}",
  "verificationMethod": [
    {
      "id": "did:web:${DOMAIN}#atproto",
      "type": "JsonWebKey2020",
      "controller": "did:web:${DOMAIN}",
      "publicKeyJwk": {
        "kty": "EC",
        "crv": "P-256",
        "x": "${X_B64}",
        "y": "${Y_B64}"
      }
    }
  ],
  "authentication": ["did:web:${DOMAIN}#atproto"],
  "assertionMethod": ["did:web:${DOMAIN}#atproto"],
  "service": [
    {
      "id": "did:web:${DOMAIN}#appview",
      "type": "AppView",
      "serviceEndpoint": "https://${DOMAIN}"
    }
  ]
}
EOF

# Create private JWK for signing
cat > appview-signing-key.json << EOF
{
  "kty": "EC",
  "crv": "P-256",
  "x": "${X_B64}",
  "y": "${Y_B64}",
  "d": "${PRIVATE_D}",
  "kid": "did:web:${DOMAIN}#atproto"
}
EOF

# Create environment variables file
cat > .env.webdid << EOF
# WebDID Configuration
APPVIEW_DID=did:web:${DOMAIN}

# Store the signing key securely (not in git!)
# For production: use a secrets manager
EOF

echo ""
echo "✅ WebDID setup complete!"
echo ""
echo "📁 Files created:"
echo "  - public/did.json (DID document - commit this)"
echo "  - appview-signing-key.json (KEEP SECRET! Add to .gitignore)"
echo "  - appview-private.pem (KEEP SECRET! Add to .gitignore)" 
echo "  - appview-public.pem (public key - safe to share)"
echo "  - .env.webdid (environment variables)"
echo ""
echo "📋 Next steps:"
echo ""
echo "1. Add secrets to .gitignore:"
echo "   echo 'appview-signing-key.json' >> .gitignore"
echo "   echo 'appview-private.pem' >> .gitignore"
echo ""
echo "2. Set environment variable:"
echo "   export APPVIEW_DID=did:web:${DOMAIN}"
echo "   Or add to your .env file"
echo ""
echo "3. Point your subdomain to this server"
echo "   DNS A record: ${DOMAIN} → your-server-ip"
echo ""
echo "4. Enable HTTPS (required for did:web)"
echo "   - On Replit: Deploy to production (auto HTTPS)"
echo "   - On VPS: Use certbot/Let's Encrypt"
echo ""
echo "5. Verify DID is accessible:"
echo "   curl https://${DOMAIN}/.well-known/did.json"
echo ""
echo "🎉 Your AppView will be: did:web:${DOMAIN}"
