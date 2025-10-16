import { Router } from 'express';
// Placeholder for graph routes (follows, blocks, mutes, relationships)
const router = Router();

router.post('/getFollowers', (_req, res) => {
  res.status(501).json({ error: 'Not implemented yet' });
});

router.post('/getFollows', (_req, res) => {
  res.status(501).json({ error: 'Not implemented yet' });
});

router.post('/getRelationships', (_req, res) => {
  res.status(501).json({ error: 'Not implemented yet' });
});

router.post('/getBlocks', (_req, res) => {
  res.status(501).json({ error: 'Not implemented yet' });
});

router.post('/getMutes', (_req, res) => {
  res.status(501).json({ error: 'Not implemented yet' });
});

export { router as graphRoutes };
