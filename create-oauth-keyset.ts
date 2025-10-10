#!/usr/bin/env tsx
import { readFileSync, writeFileSync } from 'fs';

const privateKeyPem = readFileSync('oauth-private-key.pem', 'utf-8');

const keyset = {
  privateKeyPem: privateKeyPem,
  kid: 'appview-oauth-key'
};

writeFileSync('oauth-keyset.json', JSON.stringify(keyset, null, 2));
console.log('✅ OAuth keyset created successfully');
console.log('Contents:', JSON.stringify(keyset, null, 2));
