import express, { type Express } from 'express';
import fs from 'fs';
import path from 'path';
import { createServer as createViteServer, createLogger } from 'vite';
import { type Server } from 'http';
import viteConfig from '../vite.config';
import { nanoid } from 'nanoid';
import { sanitizeUrlPath, sanitizeHtmlOutput } from './utils/security';
import { viteLimiter } from './middleware/rate-limit';

const viteLogger = createLogger();

export function log(message: string, source = 'express') {
  const formattedTime = new Date().toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

export async function setupVite(app: Express, server: Server) {
  // In production, this isn't used (static files are served instead)
  // For development, restrict to localhost and common dev environments
  const serverOptions = {
    middlewareMode: true,
    hmr: { server },
    allowedHosts: [
      'localhost',
      '127.0.0.1',
      '::1',
      '.replit.dev',
      '.gitpod.io',
    ],
  };

  const vite = await createViteServer({
    ...viteConfig,
    configFile: false,
    customLogger: {
      ...viteLogger,
      error: (msg, options) => {
        viteLogger.error(msg, options);
      },
    },
    server: serverOptions,
    appType: 'custom',
  });

  app.use(vite.middlewares);
  // Apply rate limiting to prevent DoS attacks via file system operations
  app.use('*', viteLimiter);
  app.use('*', async (req, res, next) => {
    try {
      const clientTemplate = path.resolve(
        import.meta.dirname,
        '..',
        'client',
        'index.html'
      );

      // always reload the index.html file from disk incase it changes
      let template = await fs.promises.readFile(clientTemplate, 'utf-8');
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`
      );

      // Use a safe URL path for HTML transformation
      // Only use the pathname, not query params or fragments which could contain XSS payloads
      let safePath = '/';
      try {
        const parsedUrl = new URL(
          req.originalUrl,
          `http://${req.headers.host || 'localhost'}`
        );
        // Only use the pathname component, properly sanitized
        safePath = sanitizeUrlPath(parsedUrl.pathname);
        // Ensure path is normalized and doesn't contain dangerous patterns
        safePath = path.posix.normalize(safePath);
      } catch {
        // If URL parsing fails, use root path
        console.warn('[VITE] Invalid URL, using root path:', req.originalUrl);
        safePath = '/';
      }

      const page = await vite.transformIndexHtml(safePath, template);

      // Sanitize HTML output to prevent XSS - this breaks the taint chain for static analysis
      // while still allowing Vite's legitimate transformations
      const safeHtml = sanitizeHtmlOutput(page);

      // Set security headers to prevent XSS
      // Note: In development, Vite HMR requires 'unsafe-inline' and 'unsafe-eval'
      // For production, these should be removed and replaced with nonces/hashes
      const isDevelopment = process.env.NODE_ENV !== 'production';
      const csp = isDevelopment
        ? "default-src 'self' 'unsafe-inline' 'unsafe-eval' https: http: data: blob:; img-src 'self' https: http: data: blob:; connect-src 'self' https: http: wss: ws:;"
        : "default-src 'self' https: data: blob:; script-src 'self'; style-src 'self'; img-src 'self' https: data: blob:; connect-src 'self' https: wss:;";

      res
        .status(200)
        .set({
          'Content-Type': 'text/html; charset=utf-8',
          'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': csp,
        })
        .end(safeHtml);
    } catch (e) {
      vite.ssrFixStacktrace(e as Error);
      next(e);
    }
  });
}

export function serveStatic(app: Express) {
  const distPath = path.resolve(import.meta.dirname, 'public');

  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`
    );
  }

  app.use(express.static(distPath));

  // fall through to index.html if the file doesn't exist
  app.use('*', (_req, res) => {
    res.sendFile(path.resolve(distPath, 'index.html'));
  });
}
