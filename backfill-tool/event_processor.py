"""
Event processor for AT Protocol firehose events.

Handles different record types and writes to database.
"""

from datetime import datetime
from typing import Dict, Any, Optional
from database import DatabaseAdapter


class EventProcessor:
    """Process AT Protocol firehose events"""
    
    def __init__(self, db: DatabaseAdapter):
        self.db = db
        
    async def process_event(self, event: Dict[str, Any]):
        """Process a single event from the firehose"""
        event_type = event.get('event')
        
        if not event_type:
            return
        
        # Handle different event types
        if event_type == 'create':
            await self._handle_create(event)
        elif event_type == 'update':
            await self._handle_update(event)
        elif event_type == 'delete':
            await self._handle_delete(event)
        elif event_type == 'identity':
            await self._handle_identity(event)
        elif event_type == 'account':
            await self._handle_account(event)
    
    async def _handle_create(self, event: Dict[str, Any]):
        """Handle create event"""
        collection = event.get('collection', '')
        
        # Ensure author exists
        did = event.get('did')
        if did:
            await self.db.ensure_user(did)
        
        # Route to collection-specific handler
        if collection == 'app.bsky.feed.post':
            await self._create_post(event)
        elif collection == 'app.bsky.feed.like':
            await self._create_like(event)
        elif collection == 'app.bsky.feed.repost':
            await self._create_repost(event)
        elif collection == 'app.bsky.graph.follow':
            await self._create_follow(event)
        elif collection == 'app.bsky.graph.block':
            await self._create_block(event)
        elif collection == 'app.bsky.actor.profile':
            await self._update_profile(event)
    
    async def _handle_update(self, event: Dict[str, Any]):
        """Handle update event (treat same as create)"""
        await self._handle_create(event)
    
    async def _handle_delete(self, event: Dict[str, Any]):
        """Handle delete event"""
        did = event.get('did')
        collection = event.get('collection', '')
        rkey = event.get('rkey', '')
        
        if not did or not collection or not rkey:
            return
        
        # Construct URI
        uri = f"at://{did}/{collection}/{rkey}"
        
        # Delete from database
        await self.db.delete_record(uri, collection)
    
    async def _handle_identity(self, event: Dict[str, Any]):
        """Handle identity event (handle change)"""
        did = event.get('did')
        handle = event.get('handle')
        
        if did and handle:
            await self.db.ensure_user(did, handle)
    
    async def _handle_account(self, event: Dict[str, Any]):
        """Handle account event (account status)"""
        # For now, just ensure user exists
        did = event.get('did')
        if did:
            await self.db.ensure_user(did)
    
    # ===== Collection Handlers =====
    
    async def _create_post(self, event: Dict[str, Any]):
        """Create a post"""
        did = event.get('did')
        collection = event.get('collection')
        rkey = event.get('rkey')
        record = event.get('record', {})
        cid = event.get('cid')
        
        uri = f"at://{did}/{collection}/{rkey}"
        
        # Extract post fields
        text = record.get('text', '')
        created_at = record.get('createdAt')
        
        # Parse created_at
        if created_at:
            try:
                created_at = datetime.fromisoformat(created_at.replace('Z', '+00:00'))
            except:
                created_at = datetime.utcnow()
        else:
            created_at = datetime.utcnow()
        
        # Extract reply info
        reply_parent = None
        reply_root = None
        if 'reply' in record:
            reply = record['reply']
            if 'parent' in reply:
                reply_parent = reply['parent'].get('uri')
            if 'root' in reply:
                reply_root = reply['root'].get('uri')
        
        # Extract embed info
        embed_type = None
        embed_uri = None
        if 'embed' in record:
            embed = record['embed']
            embed_type = embed.get('$type')
            
            # Extract URI for different embed types
            if 'record' in embed:
                embed_uri = embed['record'].get('uri')
            elif 'external' in embed:
                embed_uri = embed['external'].get('uri')
        
        # Extract langs
        langs = record.get('langs', [])
        
        # Extract labels
        labels = []
        if 'labels' in record:
            labels_data = record['labels']
            if isinstance(labels_data, dict) and 'values' in labels_data:
                labels = [label.get('val') for label in labels_data['values'] if 'val' in label]
        
        # Extract tags (facets with tag type)
        tags = []
        if 'facets' in record:
            for facet in record['facets']:
                if 'features' in facet:
                    for feature in facet['features']:
                        if feature.get('$type') == 'app.bsky.richtext.facet#tag':
                            tag = feature.get('tag')
                            if tag:
                                tags.append(tag)
        
        # Create post data
        post_data = {
            'uri': uri,
            'cid': cid,
            'author_did': did,
            'text': text,
            'created_at': created_at,
            'reply_parent': reply_parent,
            'reply_root': reply_root,
            'embed_type': embed_type,
            'embed_uri': embed_uri,
            'langs': langs,
            'labels': labels,
            'tags': tags,
        }
        
        await self.db.create_post(post_data)
    
    async def _create_like(self, event: Dict[str, Any]):
        """Create a like"""
        did = event.get('did')
        collection = event.get('collection')
        rkey = event.get('rkey')
        record = event.get('record', {})
        cid = event.get('cid')
        
        uri = f"at://{did}/{collection}/{rkey}"
        
        # Extract subject
        subject = record.get('subject', {})
        subject_uri = subject.get('uri')
        
        if not subject_uri:
            return
        
        # Ensure subject author exists
        subject_did = self._extract_did_from_uri(subject_uri)
        if subject_did:
            await self.db.ensure_user(subject_did)
        
        # Parse created_at
        created_at = record.get('createdAt')
        if created_at:
            try:
                created_at = datetime.fromisoformat(created_at.replace('Z', '+00:00'))
            except:
                created_at = datetime.utcnow()
        else:
            created_at = datetime.utcnow()
        
        like_data = {
            'uri': uri,
            'cid': cid,
            'author_did': did,
            'subject_uri': subject_uri,
            'created_at': created_at,
        }
        
        await self.db.create_like(like_data)
    
    async def _create_repost(self, event: Dict[str, Any]):
        """Create a repost"""
        did = event.get('did')
        collection = event.get('collection')
        rkey = event.get('rkey')
        record = event.get('record', {})
        cid = event.get('cid')
        
        uri = f"at://{did}/{collection}/{rkey}"
        
        # Extract subject
        subject = record.get('subject', {})
        subject_uri = subject.get('uri')
        
        if not subject_uri:
            return
        
        # Ensure subject author exists
        subject_did = self._extract_did_from_uri(subject_uri)
        if subject_did:
            await self.db.ensure_user(subject_did)
        
        # Parse created_at
        created_at = record.get('createdAt')
        if created_at:
            try:
                created_at = datetime.fromisoformat(created_at.replace('Z', '+00:00'))
            except:
                created_at = datetime.utcnow()
        else:
            created_at = datetime.utcnow()
        
        repost_data = {
            'uri': uri,
            'cid': cid,
            'author_did': did,
            'subject_uri': subject_uri,
            'created_at': created_at,
        }
        
        await self.db.create_repost(repost_data)
    
    async def _create_follow(self, event: Dict[str, Any]):
        """Create a follow"""
        did = event.get('did')
        collection = event.get('collection')
        rkey = event.get('rkey')
        record = event.get('record', {})
        cid = event.get('cid')
        
        uri = f"at://{did}/{collection}/{rkey}"
        
        # Extract subject DID
        subject_did = record.get('subject')
        
        if not subject_did:
            return
        
        # Ensure subject exists
        await self.db.ensure_user(subject_did)
        
        # Parse created_at
        created_at = record.get('createdAt')
        if created_at:
            try:
                created_at = datetime.fromisoformat(created_at.replace('Z', '+00:00'))
            except:
                created_at = datetime.utcnow()
        else:
            created_at = datetime.utcnow()
        
        follow_data = {
            'uri': uri,
            'cid': cid,
            'author_did': did,
            'subject_did': subject_did,
            'created_at': created_at,
        }
        
        await self.db.create_follow(follow_data)
    
    async def _create_block(self, event: Dict[str, Any]):
        """Create a block"""
        did = event.get('did')
        collection = event.get('collection')
        rkey = event.get('rkey')
        record = event.get('record', {})
        cid = event.get('cid')
        
        uri = f"at://{did}/{collection}/{rkey}"
        
        # Extract subject DID
        subject_did = record.get('subject')
        
        if not subject_did:
            return
        
        # Ensure subject exists
        await self.db.ensure_user(subject_did)
        
        # Parse created_at
        created_at = record.get('createdAt')
        if created_at:
            try:
                created_at = datetime.fromisoformat(created_at.replace('Z', '+00:00'))
            except:
                created_at = datetime.utcnow()
        else:
            created_at = datetime.utcnow()
        
        block_data = {
            'uri': uri,
            'cid': cid,
            'author_did': did,
            'subject_did': subject_did,
            'created_at': created_at,
        }
        
        await self.db.create_block(block_data)
    
    async def _update_profile(self, event: Dict[str, Any]):
        """Update user profile"""
        did = event.get('did')
        record = event.get('record', {})
        
        # Ensure user exists
        await self.db.ensure_user(did)
        
        # Extract profile fields
        display_name = record.get('displayName')
        description = record.get('description')
        
        # Extract avatar
        avatar = None
        if 'avatar' in record:
            avatar_data = record['avatar']
            if isinstance(avatar_data, dict):
                # Avatar is a blob reference
                avatar = avatar_data.get('ref', {}).get('$link')
            elif isinstance(avatar_data, str):
                avatar = avatar_data
        
        # Extract banner
        banner = None
        if 'banner' in record:
            banner_data = record['banner']
            if isinstance(banner_data, dict):
                banner = banner_data.get('ref', {}).get('$link')
            elif isinstance(banner_data, str):
                banner = banner_data
        
        profile_data = {
            'did': did,
            'display_name': display_name,
            'description': description,
            'avatar': avatar,
            'banner': banner,
        }
        
        await self.db.update_profile(profile_data)
    
    # ===== Utility Methods =====
    
    def _extract_did_from_uri(self, uri: str) -> Optional[str]:
        """Extract DID from AT-URI (at://did:plc:xxx/...)"""
        if not uri or not uri.startswith('at://'):
            return None
        
        parts = uri[5:].split('/')  # Remove 'at://' and split
        return parts[0] if parts else None
