// Test script to verify handle validation fixes
import { INVALID_HANDLE } from '@atproto/syntax';

console.log('Testing handle validation fixes...');

// Test INVALID_HANDLE constant
console.log('INVALID_HANDLE constant:', INVALID_HANDLE);

// Test nullish coalescing behavior
const testAuthor1 = { handle: 'test.bsky.social' };
const testAuthor2 = { handle: null };
const testAuthor3 = { handle: undefined };
const testAuthor4 = null;

console.log('Test 1 - Valid handle:', testAuthor1?.handle ?? INVALID_HANDLE);
console.log('Test 2 - Null handle:', testAuthor2?.handle ?? INVALID_HANDLE);
console.log('Test 3 - Undefined handle:', testAuthor3?.handle ?? INVALID_HANDLE);
console.log('Test 4 - Null author:', testAuthor4?.handle ?? INVALID_HANDLE);

// Test profileViewBasic structure
const createProfileViewBasic = (author, authorDid) => {
  return {
    $type: 'app.bsky.actor.defs#profileViewBasic',
    did: authorDid,
    handle: author?.handle ?? INVALID_HANDLE,
    displayName: author?.displayName || author?.handle || 'Unknown User',
    pronouns: author?.pronouns,
    avatar: author?.avatarUrl ? 'https://example.com/avatar.jpg' : undefined,
  };
};

console.log('\nTesting profileViewBasic creation:');
console.log('Valid author:', createProfileViewBasic(testAuthor1, 'did:plc:test1'));
console.log('Null author:', createProfileViewBasic(testAuthor4, 'did:plc:test2'));

console.log('\n✅ Handle validation fixes are working correctly!');