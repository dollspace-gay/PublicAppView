# Legacy Code Cleanup - Password Auth Removal

## ✅ Removed Files

### 1. `server/services/dashboard-auth.ts`
**Reason**: Completely unused. All auth uses AT Protocol OAuth.

**What it was**:
- Password-based dashboard authentication service
- SHA256 password hashing (flagged by security audit)
- JWT token generation for dashboard sessions

**Why unused**:
- No imports anywhere in codebase
- `requireDashboardAuth` middleware never used
- All endpoints use `requireAuth` (OAuth) or `requireAdmin` (OAuth + DID check)

---

### 2. `client/src/components/dashboard-auth-guard.tsx`
**Reason**: Unused component, references non-existent endpoint.

**What it was**:
- React component to guard dashboard routes
- Called `/api/dashboard/check-auth` (doesn't exist)
- Checked for `dashboard_token` in localStorage

**Why unused**:
- Not imported in `App.tsx` or any other component
- The `/api/dashboard/check-auth` endpoint doesn't exist
- Dashboard pages handle their own auth checks

---

### 3. `.env.example` - Removed DASHBOARD_PASSWORD
**Before**:
```bash
# ============================================
# OPTIONAL: Dashboard Authentication
# ============================================
# Password for dashboard access (leave blank for no authentication)
# Recommended: Set a strong password in production
DASHBOARD_PASSWORD=
```

**After**:
```bash
# ============================================
# Admin Authorization
# ============================================
# Comma-separated list of admin DIDs or handles
# Only users in this list can access admin panel and moderation features
# Example: ADMIN_DIDS=did:plc:abc123,alice.bsky.social,bob.example.com
ADMIN_DIDS=
```

---

## 📝 Important Clarification: `dashboard_token` in localStorage

### What It Actually Is
The `dashboard_token` in localStorage is **NOT** a password-based token. It's the **OAuth session JWT**.

### Actual Auth Flow
```
1. User logs in with AT Protocol handle
   ↓
2. OAuth flow with their PDS
   ↓
3. Server creates JWT session token
   ↓
4. Token stored in:
   - httpOnly cookie: auth_token (primary, secure)
   - localStorage: dashboard_token (fallback for client-side checks)
   ↓
5. All API requests use the cookie automatically
```

### Why Two Storage Locations?

**Primary: httpOnly Cookie (`auth_token`)**
- Set by server in `/api/auth/callback`
- httpOnly = not accessible to JavaScript (XSS protection)
- Sent automatically with all requests
- Most secure

**Secondary: localStorage (`dashboard_token`)**
- Used by client for:
  - Quick session checks before API calls
  - Client-side routing decisions
  - Showing/hiding UI elements
- Less secure but needed for SPA functionality
- Server always validates the httpOnly cookie, not this

### No Password Authentication Anywhere!
- ✅ All users authenticate via AT Protocol OAuth
- ✅ No passwords stored or managed by this application
- ✅ Admin access controlled by DID whitelist (ADMIN_DIDS)
- ✅ No password hashing needed

---

## 🔍 Verification

### Files Deleted
```bash
✅ server/services/dashboard-auth.ts
✅ client/src/components/dashboard-auth-guard.tsx
✅ scripts/generate-dashboard-password.js (was created then deleted)
```

### Dependencies Removed
```bash
✅ bcrypt (was installed then removed)
✅ @types/bcrypt (was installed then removed)
```

### Environment Variables Updated
```bash
❌ DASHBOARD_PASSWORD (removed from .env.example)
✅ ADMIN_DIDS (added to .env.example with proper docs)
```

---

## 📊 Final High Priority Fixes Summary

### Completed Fixes: 4/5 (100% of applicable fixes)

1. ✅ **Duplicate WebSocket Handler** - Fixed
2. ✅ **CORS Array Mutation** - Fixed
3. ✅ **Admin Authorization Bypass** - Fixed
4. ✅ **Auth Token in URL** - Improved
5. ⏭️ **Password Hashing** - N/A (no passwords used)

### Security Improvements
- 🛡️ Server-side admin authorization enforced
- 🛡️ Memory leak eliminated
- 🛡️ Critical WebSocket bug fixed
- 🛡️ Token exposure minimized
- 🛡️ Legacy insecure code removed

---

## 🚀 Next Priority Items

Based on SECURITY_PRIORITIES.md, the next critical items are:

### Week 1 Remaining:
1. **Refresh token encryption** (`server/services/oauth-service.ts:122`)
   - Refresh tokens stored unencrypted in database
   - Should use encryption service

2. **Silent error suppression** (`import-car.ts:235`)
   - Import errors caught without logging
   - Implement proper error handling

3. **DID validation** (`server/services/did-resolver.ts:409`)
   - DID mismatches only logged, not rejected
   - Should throw error on mismatch

4. **SSRF vulnerabilities** (`server/services/xrpc-api.ts:349`)
   - Unvalidated PDS endpoints from DID documents
   - Validate URLs, deny private IPs

---

## ✨ Bonus: Code Health Improvement

By removing unused legacy code, we've:
- ✅ Reduced attack surface
- ✅ Eliminated confusion about auth methods
- ✅ Removed insecure password hashing
- ✅ Clarified actual auth architecture
- ✅ Reduced maintenance burden

**Total lines removed**: ~150 (dashboard-auth.ts + dashboard-auth-guard.tsx + script)
