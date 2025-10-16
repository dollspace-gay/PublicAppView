import { Router } from 'express';
// Placeholder for notification routes
const router = Router();

router.post('/listNotifications', (_req, res) => {
  res.status(501).json({ error: 'Not implemented yet' });
});

router.post('/getUnreadCount', (_req, res) => {
  res.status(501).json({ error: 'Not implemented yet' });
});

export { router as notificationRoutes };
