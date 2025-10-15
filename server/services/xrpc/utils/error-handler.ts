/**
 * Error Handling Utilities
 * Centralized error handling for XRPC API endpoints
 */

import type { Response } from 'express';
import { z } from 'zod';

/**
 * Handle errors in XRPC endpoints
 * Provides appropriate HTTP status codes and error messages
 */
export function handleError(
  res: Response,
  error: unknown,
  context: string
): void {
  console.error(`[XRPC] Error in ${context}:`, error);

  if (error instanceof z.ZodError) {
    res.status(400).json({ error: 'InvalidRequest', message: error.errors });
    return;
  }

  // A simple check for a custom not found error or similar
  if (error instanceof Error && error.message.includes('NotFound')) {
    res.status(404).json({ error: 'NotFound', message: error.message });
    return;
  }

  // Handle network/fetch errors and upstream service failures
  if (error instanceof Error) {
    if (
      error.message.includes('fetch') ||
      error.message.includes('network') ||
      error.message.includes('ECONNREFUSED') ||
      error.message.includes('ETIMEDOUT') ||
      error.message.includes('upstream') ||
      error.message.toLowerCase().includes('unreachable')
    ) {
      res.status(502).json({
        error: 'UpstreamServiceUnavailable',
        message:
          'Upstream service is temporarily unavailable. Please try again later.',
      });
      return;
    }
  }

  res.status(500).json({
    error: 'InternalServerError',
    message: 'An internal error occurred',
  });
}
