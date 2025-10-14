import type { Request, Response, NextFunction } from "express";
import { authService, validateAndRefreshSession } from "../services/auth";
import { pdsClient } from "../services/pds-client";
import { isContentTypeSafe, sanitizeResponseHeaders } from "../utils/security";

/**
 * A catch-all middleware to proxy authenticated XRPC requests
 * to the user's Personal Data Server (PDS).
 *
 * This middleware handles both authentication methods:
 * 1. Local session tokens: Verifies session, refreshes PDS token if needed, proxies with session's PDS token
 * 2. AT Protocol access tokens: Verifies token cryptographically, resolves PDS endpoint, proxies with original token
 *
 * This enables third-party clients to authenticate using standard AT Protocol access tokens
 * while maintaining compatibility with the appview's local session system.
 */
export const xrpcProxyMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  // Only proxy XRPC methods that haven't been explicitly handled yet.
  if (!req.path.startsWith("/xrpc/")) {
    return next();
  }

  try {
    // 1. Extract and verify the token (handles both local session tokens and AT Protocol access tokens)
    const token = authService.extractToken(req);
    if (!token) {
      // If no token, it's not an authenticated request we should proxy.
      return next();
    }

    // 2. Verify the token using the unified verification method
    const authPayload = await authService.verifyToken(token);
    if (!authPayload?.did) {
      // If the token is invalid, let it fall through to other handlers
      return next();
    }

    const userDid = authPayload.did;

    // 3. Handle different token types
    if (authPayload.sessionId) {
      // Local session token - validate session and refresh PDS token if needed
      const session = await validateAndRefreshSession(authPayload.sessionId);
      if (!session) {
        return res.status(401).json({ error: "SessionNotFound", message: "Your session could not be found or has expired." });
      }

      const pdsAccessToken = session.accessToken;
      const pdsEndpoint = session.pdsEndpoint;

      if (!pdsAccessToken || !pdsEndpoint) {
        console.error(`[XRPC_PROXY] Session for ${session.userDid} is missing PDS credentials.`);
        return res.status(500).json({ error: "InvalidSessionState", message: "Session is missing PDS credentials." });
      }

      console.log(
        `[XRPC_PROXY] Proxying ${req.method} ${req.path} to ${pdsEndpoint} for ${session.userDid} (local session)`
      );

      // Forward the request to the PDS with the session's access token
      const pdsResponse = await pdsClient.proxyXRPC(
          pdsEndpoint,
          req.method,
          req.path,
          req.query,
          pdsAccessToken,
          req.body,
          req.headers
      );

      // Validate content type to prevent XSS attacks
      const contentType = pdsResponse.headers['content-type'];
      if (!isContentTypeSafe(contentType)) {
        console.error(`[XRPC_PROXY] Unsafe content-type from PDS: ${contentType}`);
        return res.status(500).json({ error: "UnsafeResponse", message: "PDS returned unsafe content type." });
      }

      // Sanitize headers to prevent header injection attacks
      const sanitizedHeaders = sanitizeResponseHeaders(pdsResponse.headers);
      
      // For JSON responses, ensure we're sending valid JSON
      if (contentType && contentType.includes('application/json')) {
        try {
          // Parse and re-stringify to ensure it's valid JSON and prevent injection
          const jsonBody = typeof pdsResponse.body === 'string' 
            ? JSON.parse(pdsResponse.body) 
            : pdsResponse.body;
          return res.status(pdsResponse.status).set(sanitizedHeaders).json(jsonBody);
        } catch (error) {
          console.error(`[XRPC_PROXY] Invalid JSON from PDS:`, error);
          return res.status(500).json({ error: "InvalidResponse", message: "PDS returned invalid JSON." });
        }
      }
      
      // For other content types, ensure we set the content type explicitly and send safely
      // This prevents Express from interpreting the response as HTML
      const safeHeaders = {
        ...sanitizedHeaders,
        'Content-Type': contentType || 'application/octet-stream',
        'X-Content-Type-Options': 'nosniff'
      };
      
      // For binary/non-JSON content, send as buffer to prevent interpretation as HTML
      const bodyBuffer = typeof pdsResponse.body === 'string' 
        ? Buffer.from(pdsResponse.body, 'utf-8') 
        : Buffer.from(pdsResponse.body);
      
      res.status(pdsResponse.status).set(safeHeaders).send(bodyBuffer);

    } else {
      // AT Protocol access token from third-party client - use it directly
      console.log(
        `[XRPC_PROXY] Proxying ${req.method} ${req.path} for ${userDid} (AT Protocol token)`
      );

      // For AT Protocol tokens, we need to determine the PDS endpoint from the user's DID
      const { didResolver } = await import("../services/did-resolver");
      const pdsEndpoint = await didResolver.resolveDIDToPDS(userDid);
      
      if (!pdsEndpoint) {
        console.error(`[XRPC_PROXY] Could not resolve PDS endpoint for DID: ${userDid}`);
        return res.status(500).json({ error: "PDSNotFound", message: "Could not determine PDS endpoint for user." });
      }

      // Forward the request to the PDS with the original AT Protocol access token
      const pdsResponse = await pdsClient.proxyXRPC(
          pdsEndpoint,
          req.method,
          req.path,
          req.query,
          token, // Use the original AT Protocol access token
          req.body,
          req.headers
      );

      // Validate content type to prevent XSS attacks
      const contentType = pdsResponse.headers['content-type'];
      if (!isContentTypeSafe(contentType)) {
        console.error(`[XRPC_PROXY] Unsafe content-type from PDS: ${contentType}`);
        return res.status(500).json({ error: "UnsafeResponse", message: "PDS returned unsafe content type." });
      }

      // Sanitize headers to prevent header injection attacks
      const sanitizedHeaders = sanitizeResponseHeaders(pdsResponse.headers);
      
      // For JSON responses, ensure we're sending valid JSON
      if (contentType && contentType.includes('application/json')) {
        try {
          // Parse and re-stringify to ensure it's valid JSON and prevent injection
          const jsonBody = typeof pdsResponse.body === 'string' 
            ? JSON.parse(pdsResponse.body) 
            : pdsResponse.body;
          return res.status(pdsResponse.status).set(sanitizedHeaders).json(jsonBody);
        } catch (error) {
          console.error(`[XRPC_PROXY] Invalid JSON from PDS:`, error);
          return res.status(500).json({ error: "InvalidResponse", message: "PDS returned invalid JSON." });
        }
      }
      
      // For other content types, ensure we set the content type explicitly and send safely
      // This prevents Express from interpreting the response as HTML
      const safeHeaders = {
        ...sanitizedHeaders,
        'Content-Type': contentType || 'application/octet-stream',
        'X-Content-Type-Options': 'nosniff'
      };
      
      // For binary/non-JSON content, send as buffer to prevent interpretation as HTML
      const bodyBuffer = typeof pdsResponse.body === 'string' 
        ? Buffer.from(pdsResponse.body, 'utf-8') 
        : Buffer.from(pdsResponse.body);
      
      res.status(pdsResponse.status).set(safeHeaders).send(bodyBuffer);
    }

  } catch (error) {
    console.error(`[XRPC_PROXY] Error proxying request:`, error);
    
    // Handle network/fetch errors gracefully
    if (error instanceof Error) {
      if (error.message.includes('fetch') || 
          error.message.includes('network') || 
          error.message.includes('ECONNREFUSED') ||
          error.message.includes('ETIMEDOUT') ||
          error.message.includes('upstream') ||
          error.message.toLowerCase().includes('unreachable')) {
        return res.status(502).json({ 
          error: 'UpstreamServiceUnavailable', 
          message: 'The upstream service is temporarily unavailable. Please try again later.'
        });
      }
    }
    
    return next(error);
  }
};