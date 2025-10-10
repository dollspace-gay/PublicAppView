#!/usr/bin/env tsx
import { generateKeyPairSync } from 'crypto';
import { writeFileSync } from 'fs';

console.log('🔐 Generating OAuth keys for AT Protocol AppView...\n');

// Generate ES256 keypair (P-256 curve)
const { privateKey, publicKey } = generateKeyPairSync('ec', {
  namedCurve: 'P-256',
  publicKeyEncoding: {
    type: 'spki',
    format: 'pem'
  },
  privateKeyEncoding: {
    type: 'pkcs8',
    format: 'pem'
  }
});

// Extract public key components for JWK
const crypto = await import('crypto');
const keyObject = crypto.createPublicKey(publicKey);
const jwk = keyObject.export({ format: 'jwk' }) as any;

// Create keyset with both keys
const keyset = [
  {
    kty: 'EC',
    crv: 'P-256',
    x: jwk.x,
    y: jwk.y,
    d: crypto.createPrivateKey(privateKey).export({ format: 'jwk' }).d,
    use: 'sig',
    alg: 'ES256',
    kid: 'appview-key-1'
  }
];

// Save keyset
const keysetPath = 'oauth-keyset.json';
writeFileSync(keysetPath, JSON.stringify(keyset, null, 2));
console.log(`✅ OAuth keyset saved to: ${keysetPath}`);

// Also save PEM format for compatibility
writeFileSync('oauth-private-key.pem', privateKey);
writeFileSync('oauth-public-key.pem', publicKey);
console.log('✅ PEM keys saved to: oauth-private-key.pem, oauth-public-key.pem');

console.log('\n📋 Next steps:');
console.log('1. Keys are ready to use');
console.log('2. Server will automatically load oauth-keyset.json');
console.log('3. Restart the server to apply the new keys\n');
