#!/usr/bin/env tsx
import { readFileSync, writeFileSync } from 'fs';

const privateKeyPem = readFileSync('oauth-private-key.pem', 'utf-8');

const keyset = {
  privateKeyPem: privateKeyPem,
  kid: 'appview-oauth-key'
};

// Write with restrictive file permissions (owner-only read/write)
writeFileSync('oauth-keyset.json', JSON.stringify(keyset, null, 2), { mode: 0o600 });
console.log('✅ OAuth keyset created successfully');
console.log('Keyset file written to oauth-keyset.json with secure permissions (0600)');
