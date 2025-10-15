import { Request, Response, NextFunction } from 'express';
import {
  createDataLoader,
  HydrationDataLoader,
} from '../services/hydration/dataloader';

// Extend Express Request type to include dataLoader
declare global {
  namespace Express {
    interface Request {
      dataLoader?: HydrationDataLoader;
    }
  }
}

/**
 * Middleware that creates a request-scoped DataLoader instance
 * This ensures each request gets its own DataLoader with fresh caches
 */
export function dataLoaderMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  // Create a new DataLoader instance for this request
  req.dataLoader = createDataLoader();

  // Clean up after request completes
  res.on('finish', () => {
    if (req.dataLoader) {
      req.dataLoader.clearAll();
      req.dataLoader = undefined;
    }
  });

  next();
}

/**
 * Helper to get DataLoader from request or create a new one
 */
export function getRequestDataLoader(req: Request): HydrationDataLoader {
  if (!req.dataLoader) {
    req.dataLoader = createDataLoader();
  }
  return req.dataLoader;
}
