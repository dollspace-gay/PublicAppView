import { Router } from 'express';
// Placeholder for search routes
const router = Router();

router.post('/searchPosts', (_req, res) => {
  res.status(501).json({ error: 'Not implemented yet' });
});

export { router as searchRoutes };
