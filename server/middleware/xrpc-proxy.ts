import type { Request, Response, NextFunction } from "express";
import { authService, validateAndRefreshSession } from "../services/auth";
import { pdsClient } from "../services/pds-client";

/**
 * A catch-all middleware to proxy authenticated XRPC requests
 * to the user's Personal Data Server (PDS).
 *
 * This middleware correctly handles the two-token system and token refreshing:
 * 1. It verifies the AppView's session token to identify the user.
 * 2. It validates the session and refreshes the PDS access token if necessary.
 * 3. It uses the valid PDS access token to make the proxied request.
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
    // 1. Verify the AppView's session token to get the session ID.
    const appViewToken = authService.extractToken(req);
    if (!appViewToken) {
      // If no token, it's not an authenticated request we should proxy.
      return next();
    }

    const sessionPayload = authService.verifySessionToken(appViewToken);
    if (!sessionPayload) {
      // If the token is invalid or not a session token, let it fall through.
      return next();
    }

    // 2. Validate the session and refresh the PDS token if needed.
    const session = await validateAndRefreshSession(sessionPayload.sessionId);
    if (!session) {
      return res.status(401).json({ error: "SessionNotFound", message: "Your session could not be found or has expired." });
    }

    // 3. Use the (potentially refreshed) PDS access token.
    const pdsAccessToken = session.accessToken;
    const pdsEndpoint = session.pdsEndpoint;

    if (!pdsAccessToken || !pdsEndpoint) {
        console.error(`[XRPC_PROXY] Session for ${session.userDid} is missing PDS credentials.`);
        return res.status(500).json({ error: "InvalidSessionState", message: "Session is missing PDS credentials." });
    }

    console.log(
      `[XRPC_PROXY] Proxying ${req.method} ${req.originalUrl} to ${pdsEndpoint} for ${session.userDid}`
    );

    // 4. Forward the request to the PDS with the correct token.
    const pdsResponse = await pdsClient.proxyXRPC(
        pdsEndpoint,
        req.method,
        req.originalUrl,
        pdsAccessToken, // Use the correct PDS access token.
        req.body,
        req.headers
    );

    // 5. Send the PDS response back to the client.
    res.status(pdsResponse.status).set(pdsResponse.headers).send(pdsResponse.body);

  } catch (error) {
    console.error(`[XRPC_PROXY] Error proxying request:`, error);
    return next(error);
  }
};