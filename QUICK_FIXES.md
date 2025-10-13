# Quick Fixes - Can Be Implemented Today

## 🔥 Fix #1: Duplicate WebSocket Handler (CRITICAL BUG)

**File**: `server/routes.ts`  
**Lines**: 3189 and 3344  
**Impact**: Firehose events not broadcasting to dashboard clients

### Issue
Two `wss.on("connection")` handlers exist. The second one (line 3344) overwrites the first (line 3189), causing the firehose event subscription logic to never execute.

### Fix
Consolidate both handlers into one:

```typescript
// REMOVE the handler at line 3344 and merge its logic into the one at line 3189
wss.on("connection", (ws: WebSocket, req) => {
  console.log("[WS] Dashboard client connected from", req.headers.origin || req.headers.host);
  let connectionAlive = true;

  // First ping interval (from first handler)
  const pingInterval = setInterval(() => {
    if (!connectionAlive) {
      ws.terminate();
      return;
    }
    connectionAlive = false;
    ws.ping();
  }, 30000);

  // Welcome message
  try {
    ws.send(JSON.stringify({ 
      type: "connected", 
      message: "Dashboard WebSocket connected" 
    }));
  } catch (error) {
    console.error("[WS] Error sending welcome message:", error);
  }

  // Firehose event subscription (from first handler)
  const firehoseEventHandler = (event: any) => {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ type: "event", data: event }));
      } catch (error) {
        console.error("[WS] Error sending firehose event:", error);
      }
    }
  };
  firehoseClient.onEvent(firehoseEventHandler);

  // Metrics interval (from second handler)
  const metricsInterval = setInterval(async () => {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        const metrics = {
          firehoseStatus: await firehoseClient.getStatus(),
          storage: await storage.getStats(),
          eventCounts: firehoseClient.getEventCounts(),
          errorRate: firehoseClient.getErrorRate(),
        };
        ws.send(JSON.stringify({ type: "metrics", data: metrics }));
      } catch (error) {
        console.error("[WS] Error sending metrics:", error);
      }
    }
  }, 2000);

  ws.on("pong", () => {
    connectionAlive = true;
  });

  ws.on("close", () => {
    clearInterval(pingInterval);
    clearInterval(metricsInterval);
    firehoseClient.offEvent(firehoseEventHandler); // IMPORTANT: Clean up listener
    console.log("[WS] Client disconnected");
  });

  ws.on("error", (error) => {
    console.error("[WS] WebSocket error:", error);
  });

  ws.on("message", (data) => {
    try {
      const message = JSON.parse(data.toString());
      console.log("[WS] Received message:", message);
    } catch (error) {
      console.error("[WS] Error parsing message:", error);
    }
  });
});
```

---

## 🔥 Fix #2: CORS Array Mutation (PERFORMANCE/SECURITY)

**File**: `server/index.ts`  
**Lines**: 96-104  
**Impact**: Memory leak, potential security bypass

### Issue
The `allowedOrigins` array is rebuilt and mutated on EVERY request, causing it to grow indefinitely.

### Current Code (BAD):
```typescript
app.use((req, res, next) => {
  const origin = req.headers.origin;
  
  // Build allow list of trusted origins
  const allowedOrigins = process.env.ALLOWED_ORIGINS 
    ? process.env.ALLOWED_ORIGINS.split(',') 
    : [];
  
  // Add APPVIEW_HOSTNAME if configured (for the web UI)
  if (process.env.APPVIEW_HOSTNAME) {
    allowedOrigins.push(`https://${process.env.APPVIEW_HOSTNAME}`);
    allowedOrigins.push(`http://${process.env.APPVIEW_HOSTNAME}`);
  }
  
  // ...rest of middleware
});
```

### Fix:
```typescript
// Initialize ONCE at module level, BEFORE app.use()
const ALLOWED_ORIGINS = (() => {
  const origins = process.env.ALLOWED_ORIGINS 
    ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
    : [];
  
  if (process.env.APPVIEW_HOSTNAME) {
    origins.push(`https://${process.env.APPVIEW_HOSTNAME}`);
    origins.push(`http://${process.env.APPVIEW_HOSTNAME}`);
  }
  
  return origins;
})();

// Then use the constant in middleware
app.use((req, res, next) => {
  const origin = req.headers.origin;
  
  // For same-origin or explicitly allowed origins, enable credentials
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  
  // ...rest of middleware
});
```

---

## 🔥 Fix #3: Insecure Password Hashing (CRITICAL SECURITY)

**File**: `server/services/dashboard-auth.ts`  
**Lines**: 37-46  
**Impact**: Dashboard passwords can be brute-forced

### Issue
SHA256 is used for password hashing. It's fast and lacks salt, making it vulnerable to brute-force and rainbow table attacks.

### Steps to Fix:

1. **Install bcrypt**:
```bash
npm install bcrypt
npm install --save-dev @types/bcrypt
```

2. **Update dashboard-auth.ts**:

```typescript
import bcrypt from "bcrypt";

// Replace the verifyPassword method:
async verifyPassword(password: string): Promise<boolean> {
  if (!DASHBOARD_PASSWORD) {
    return false;
  }
  
  // If DASHBOARD_PASSWORD is a bcrypt hash, compare directly
  // Otherwise, hash it first (for backwards compatibility during migration)
  try {
    // Check if it's already a bcrypt hash (starts with $2a$, $2b$, or $2y$)
    if (DASHBOARD_PASSWORD.startsWith('$2')) {
      return await bcrypt.compare(password, DASHBOARD_PASSWORD);
    }
    
    // Legacy: plain password in env (NOT RECOMMENDED - log warning)
    console.warn('[DashboardAuth] SECURITY WARNING: DASHBOARD_PASSWORD should be a bcrypt hash!');
    return password === DASHBOARD_PASSWORD;
  } catch (error) {
    console.error('[DashboardAuth] Password verification error:', error);
    return false;
  }
}
```

3. **Generate bcrypt hash for your password**:
```bash
node -e "const bcrypt = require('bcrypt'); bcrypt.hash('your-password', 10, (e,h) => console.log(h));"
```

4. **Update your .env**:
```bash
# Replace plain password with bcrypt hash
DASHBOARD_PASSWORD=$2b$10$... (the hash from step 3)
```

---

## 🔥 Fix #4: Admin Check Bypass (CRITICAL SECURITY)

**File**: `client/src/pages/dashboard.tsx`  
**Line**: 303  
**Impact**: Client-side check can be bypassed

### Issue
Admin panel visibility is controlled client-side only. Anyone can access admin APIs by manipulating the client.

### Fix:

1. **Server-side**: Already has `requireAuth` middleware, but add admin check:

In `server/middleware/auth.ts`, add:
```typescript
export const requireAdmin = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.session?.sessionId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const session = await storage.getSession(req.session.sessionId);
    if (!session || !session.isAdmin) {
      return res.status(403).json({ error: "Forbidden - Admin access required" });
    }

    next();
  } catch (error) {
    console.error("[AUTH] Admin check error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};
```

2. **Update routes.ts**: Replace `requireAuth` with `requireAdmin` for admin endpoints:

```typescript
// OLD:
app.post("/api/admin/labels/apply", requireAuth, async (req: AuthRequest, res) => {

// NEW:
app.post("/api/admin/labels/apply", requireAdmin, async (req: AuthRequest, res) => {
```

Apply to ALL admin endpoints:
- `/api/admin/*`
- `/api/labels` (POST, DELETE)
- `/api/moderation/*`

---

## 🔥 Fix #5: Auth Tokens in URL (CRITICAL SECURITY)

**File**: `client/src/pages/dashboard.tsx`  
**Lines**: 39-52  
**Impact**: Tokens exposed in browser history, logs, referrer headers

### Fix:

The proper fix requires OAuth flow changes, but as an immediate mitigation:

1. **Clear URL immediately** (already done, but ensure it's before any navigation):
```typescript
useEffect(() => {
  const token = new URLSearchParams(window.location.search).get("token");
  
  if (token) {
    // Store token
    localStorage.setItem("dashboard_token", token);
    
    // IMMEDIATELY clear URL before any other code runs
    window.history.replaceState({}, "", window.location.pathname);
    
    // Reload to apply token
    window.location.reload();
  }
}, []);
```

2. **Better long-term fix**: Modify OAuth callback to use POST:

In `server/routes.ts`, change the OAuth callback:
```typescript
// Instead of redirecting with ?token=..., use a landing page that POSTs
app.get("/oauth/callback", async (req, res) => {
  // ... existing OAuth logic ...
  
  // Instead of:
  // res.redirect(`/?token=${sessionId}`);
  
  // Do:
  res.send(`
    <!DOCTYPE html>
    <html>
      <body>
        <script>
          localStorage.setItem('dashboard_token', '${sessionId}');
          window.location.href = '/';
        </script>
      </body>
    </html>
  `);
});
```

---

## 📋 Testing Your Fixes

After applying fixes, test:

1. **WebSocket Fix**: Check browser console and Network tab for WebSocket messages
2. **CORS Fix**: Monitor memory usage over time, check CORS headers
3. **Password Fix**: Try logging in with correct/incorrect passwords
4. **Admin Fix**: Try accessing admin endpoints without admin session
5. **Token Fix**: Check browser history doesn't contain tokens

---

## ⏱️ Time Estimates

- Fix #1 (WebSocket): 15 minutes
- Fix #2 (CORS): 5 minutes  
- Fix #3 (Password): 30 minutes (includes testing)
- Fix #4 (Admin): 45 minutes (multiple endpoints)
- Fix #5 (Token): 20 minutes

**Total**: ~2 hours to fix all 5 critical issues

---

## 🚀 After These Fixes

Continue with the SECURITY_PRIORITIES.md plan for the remaining 33 high-severity issues and systematic improvements.
