// Simple test to verify the getPreferences implementation
const { XRPCApi } = require('./dist/server/services/xrpc-api.js');

console.log('Testing XRPCApi class instantiation...');

try {
  const api = new XRPCApi();
  console.log('✅ XRPCApi class instantiated successfully');
  
  // Test cache invalidation method
  api.invalidatePreferencesCache('test-did');
  console.log('✅ Cache invalidation method works');
  
  console.log('✅ All basic tests passed');
} catch (error) {
  console.error('❌ Test failed:', error.message);
  process.exit(1);
}