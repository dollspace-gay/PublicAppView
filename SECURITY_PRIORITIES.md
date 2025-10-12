# Security Priorities - Immediate Action Required

## 🔴 CRITICAL (High Risk)

### Authentication & Authorization
1. **Client-side admin checks** (`client/src/pages/dashboard.tsx:303`)
   - Admin checks performed only on client-side can be bypassed
   - **Fix**: Enforce server-side authentication for all admin endpoints

2. **Auth tokens in URL query parameters** (`client/src/pages/dashboard.tsx:39`)
   - Tokens exposed in browser history, logs, referrer headers
   - **Fix**: Use HTTP-only cookies or POST body for token transmission

3. **Insecure password hashing** (`server/services/dashboard-auth.ts:42`)
   - SHA256 used for passwords (fast, brute-forceable)
   - **Fix**: Migrate to bcrypt, scrypt, or Argon2

### Injection Vulnerabilities
4. **XSS/SQL Injection risk** (`manual-import.ts:105`)
   - Unsanitized record data from external PDS
   - **Fix**: Implement robust input validation and parameterized queries

5. **Server-Side Request Forgery (SSRF)** (`server/services/xrpc-api.ts:349`)
   - Unvalidated PDS endpoints from DID documents
   - **Fix**: Validate URLs, whitelist schemes, deny private IP ranges

6. **Stored credentials** (`server/services/oauth-service.ts:122`)
   - Refresh tokens stored unencrypted in database
   - **Fix**: Encrypt refresh tokens at rest

### Data Integrity
7. **Silent error suppression** (`import-car.ts:235`)
   - Errors caught and ignored without logging in import loops
   - **Fix**: Log errors with context, implement dead-letter queue

8. **DID mismatch validation** (`server/services/did-resolver.ts:409`)
   - DID documents accepted even with ID mismatch (warning only)
   - **Fix**: Throw error or return null on mismatch

## 🟡 HIGH PRIORITY (Functionality Issues)

### Critical Bugs
9. **Duplicate WebSocket handlers** (`server/routes.ts:1563`)
   - Second handler overwrites first, breaking firehose events
   - **Fix**: Consolidate into single handler

10. **Hardcoded PDS endpoint** (`server/routes.ts:1306`)
   - Session refresh routes to hardcoded/default PDS
   - **Fix**: Resolve PDS from DID for each user

11. **N+1 Query Patterns** (Multiple files)
   - Sequential database queries in loops
   - **Fix**: Implement batch queries

### Performance Issues
12. **CORS array growth** (`server/index.ts:84`)
   - allowedOrigins grows indefinitely on each request
   - **Fix**: Initialize once at startup

13. **Blocking Redis KEYS command** (`server/services/cache.ts:310`)
   - Can block Redis server on large datasets
   - **Fix**: Replace with SCAN command

## 🟢 MEDIUM PRIORITY

### Code Quality
- Extensive use of `any` types reducing type safety
- Code duplication across multiple files
- Missing error handling in async operations
- Magic numbers and strings throughout codebase

### Security Hardening
- Missing input validation in multiple endpoints
- Inconsistent sanitization practices
- Overly permissive CORS configurations
- Missing rate limiting on sensitive endpoints

## 📋 Recommended Action Plan

### Week 1: Critical Security Fixes
1. Fix authentication vulnerabilities (items 1-3)
2. Address injection risks (items 4-5)
3. Encrypt stored credentials (item 6)

### Week 2: Data Integrity & Critical Bugs
1. Implement proper error handling (item 7)
2. Fix DID validation (item 8)
3. Resolve WebSocket handler bug (item 9)
4. Fix PDS endpoint resolution (item 10)

### Week 3: Performance & Code Quality
1. Optimize N+1 queries (item 11)
2. Fix CORS issue (item 12)
3. Replace blocking Redis commands (item 13)
4. Begin addressing code quality issues

### Week 4: Comprehensive Review
1. Implement systematic input validation
2. Add comprehensive test coverage for security fixes
3. Update documentation
4. Security audit of fixes

## 🛡️ Long-term Improvements

1. **Type Safety**: Reduce `any` usage, define proper interfaces
2. **Input Validation**: Implement Zod schemas for all external inputs
3. **Error Handling**: Standardize error handling patterns
4. **Monitoring**: Add security event logging and alerting
5. **Testing**: Implement security-focused integration tests
6. **Code Review**: Establish security-focused code review checklist

## 📞 Next Steps

1. Review and prioritize this list with your team
2. Create tickets for each critical issue
3. Assign owners and deadlines
4. Schedule daily standups for Week 1-2
5. Plan for security regression testing

---
Generated from AI Security Audit - $(date)
