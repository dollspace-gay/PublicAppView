import { Router } from 'express';
// Placeholder for feed generator routes
const router = Router();

router.post('/getFeedGenerators', (_req, res) => {
  res.status(501).json({ error: 'Not implemented yet' });
});

router.post('/getFeedGenerator', (_req, res) => {
  res.status(501).json({ error: 'Not implemented yet' });
});

export { router as feedGeneratorRoutes };
