// Add this temporary debugging endpoint to your routes.ts file
// Place it after the existing API endpoints (around line 2900)

app.get("/api/debug/user/:did", async (req, res) => {
  try {
    const userDid = req.params.did;
    
    // Get user settings
    const settings = await storage.getUserSettings(userDid);
    
    // Get follows
    const follows = await storage.getFollows(userDid);
    
    // Get user info
    const user = await storage.getUser(userDid);
    
    res.json({
      userDid,
      user: user ? {
        did: user.did,
        handle: user.handle,
        displayName: user.displayName,
        createdAt: user.createdAt
      } : null,
      settings: settings ? {
        dataCollectionForbidden: settings.dataCollectionForbidden,
        blockedKeywords: settings.blockedKeywords?.length || 0,
        mutedUsers: settings.mutedUsers?.length || 0,
        lastBackfillAt: settings.lastBackfillAt
      } : null,
      follows: {
        count: follows.length,
        list: follows.map(f => ({
          uri: f.uri,
          followingDid: f.followingDid,
          createdAt: f.createdAt
        }))
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/debug/timeline/:did", async (req, res) => {
  try {
    const userDid = req.params.did;
    
    // Get follows
    const followList = await storage.getFollows(userDid);
    const followingDids = followList.map(f => f.followingDid);
    
    // Get timeline posts
    const posts = await storage.getTimeline(userDid, 10);
    
    res.json({
      userDid,
      follows: {
        count: followingDids.length,
        followingDids: followingDids.slice(0, 5) // First 5 for debugging
      },
      timeline: {
        count: posts.length,
        posts: posts.slice(0, 3).map(p => ({
          uri: p.uri,
          authorDid: p.authorDid,
          text: p.text?.substring(0, 100) + '...',
          indexedAt: p.indexedAt
        }))
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});