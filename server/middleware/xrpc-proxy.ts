import type { Request, Response, NextFunction } from "express";
import { authService } from "../services/auth";
import { didResolver } from "../services/did-resolver";
import { pdsClient } from "../services/pds-client";

/**
 * A catch-all middleware to proxy authenticated XRPC write operations
 * to the user's Personal Data Server (PDS).
 *
 * This should be placed after all other specific XRPC route handlers.
 */
export const xrpcProxyMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  // Proxy authenticated XRPC methods that haven't been handled yet
  if (
    !req.path.startsWith("/xrpc/") ||
    !["GET", "POST", "PUT", "DELETE"].includes(req.method)
  ) {
    return next();
  }

  try {
    const userDid = await authService.getAuthenticatedDid(req);

    // If there's no authenticated user, this isn't a request we should proxy.
    // Let it proceed to the 404 handler.
    if (!userDid) {
      // For GET requests, it's common for them to be unauthenticated,
      // so we just pass through to the next handler (likely a 404).
      if (req.method === 'GET') {
        return next();
      }

      // For write methods, we expect authentication.
      return res.status(401).json({ error: "Authentication Required" });
    }

    // Resolve the user's PDS endpoint from their DID
    const pdsEndpoint = await didResolver.resolveDIDToPDS(userDid);

    if (!pdsEndpoint) {
      console.error(`[XRPC_PROXY] Could not resolve PDS for DID: ${userDid}`);
      return res
        .status(502)
        .json({ error: "PDS not found", message: "Could not resolve PDS" });
    }

    const accessToken = authService.extractToken(req);
    if (!accessToken) {
        // This should theoretically not be reached if userDid was resolved, but as a safeguard:
        return res.status(401).json({ error: "Authentication token not found" });
    }

    console.log(
      `[XRPC_PROXY] Proxying ${req.method} ${req.originalUrl} to ${pdsEndpoint} for ${userDid}`
    );

    // Forward the request to the PDS
    const pdsResponse = await pdsClient.proxyXRPC(
        pdsEndpoint,
        req.method,
        req.originalUrl,
        accessToken,
        req.body,
        req.headers
    );

    // Send the PDS response back to the client
    res.status(pdsResponse.status).set(pdsResponse.headers).send(pdsResponse.body);

  } catch (error) {
    console.error(`[XRPC_PROXY] Error proxying request:`, error);
    // If an error occurs (e.g., token verification fails), pass to next error handler
    return next(error);
  }
};