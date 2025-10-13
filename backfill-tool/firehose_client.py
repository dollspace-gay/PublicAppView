"""
AT Protocol Firehose WebSocket client.

Connects to the relay and streams events.
"""

import asyncio
import json
from typing import AsyncIterator, Optional, Dict, Any
import websockets
from websockets.client import WebSocketClientProtocol
import cbor2
from io import BytesIO


class FirehoseClient:
    """AT Protocol Firehose WebSocket client"""
    
    def __init__(
        self,
        relay_url: str = 'wss://bsky.network',
        start_cursor: int = 0,
    ):
        # Ensure proper endpoint
        if not relay_url.endswith('/xrpc/com.atproto.sync.subscribeRepos'):
            if relay_url.endswith('/'):
                relay_url = relay_url.rstrip('/')
            relay_url = f"{relay_url}/xrpc/com.atproto.sync.subscribeRepos"
        
        self.relay_url = relay_url
        self.start_cursor = start_cursor
        self.current_cursor = start_cursor
        self.ws: Optional[WebSocketClientProtocol] = None
        
    async def connect(self):
        """Connect to the firehose WebSocket"""
        # Add cursor parameter if specified
        url = self.relay_url
        if self.start_cursor > 0:
            url = f"{url}?cursor={self.start_cursor}"
        
        self.ws = await websockets.connect(
            url,
            max_size=10_000_000,  # 10MB max message size
            ping_interval=30,
            ping_timeout=10,
        )
        
    async def close(self):
        """Close WebSocket connection"""
        if self.ws:
            await self.ws.close()
            
    async def subscribe(self) -> AsyncIterator[Dict[str, Any]]:
        """
        Subscribe to firehose events.
        
        Yields events as dictionaries with the following structure:
        {
            'event': 'create' | 'update' | 'delete' | 'account',
            'did': str,
            'collection': str (for create/update/delete),
            'rkey': str (for create/update/delete),
            'record': dict (for create/update),
            'cid': str (for create/update),
            'seq': int,
        }
        """
        await self.connect()
        
        try:
            async for message in self.ws:
                if isinstance(message, bytes):
                    # Parse CBOR message
                    try:
                        event = await self._parse_message(message)
                        if event:
                            yield event
                    except Exception as e:
                        # Skip unparseable messages
                        continue
                        
        except websockets.exceptions.ConnectionClosed:
            pass
        except Exception as e:
            raise
        finally:
            await self.close()
    
    async def _parse_message(self, message: bytes) -> Optional[Dict[str, Any]]:
        """Parse CBOR-encoded firehose message"""
        try:
            # Decode CBOR
            data = cbor2.loads(message)
            
            # Get message type
            msg_type = data.get('$type') or data.get('t', {}).get('$type')
            
            if not msg_type:
                return None
            
            # Handle #commit messages (posts, likes, follows, etc.)
            if msg_type == '#commit' or 'commit' in str(msg_type):
                return await self._parse_commit(data)
            
            # Handle #identity messages (handle changes)
            elif msg_type == '#identity' or 'identity' in str(msg_type):
                return await self._parse_identity(data)
            
            # Handle #account messages (account status)
            elif msg_type == '#account' or 'account' in str(msg_type):
                return await self._parse_account(data)
            
            return None
            
        except Exception as e:
            return None
    
    async def _parse_commit(self, data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Parse commit event (create/update/delete)"""
        try:
            seq = data.get('seq')
            if seq:
                self.current_cursor = seq
            
            repo = data.get('repo')
            ops = data.get('ops', [])
            blocks = data.get('blocks')
            
            if not ops:
                return None
            
            # Parse operations
            events = []
            for op in ops:
                action = op.get('action')
                path = op.get('path', '')
                cid = op.get('cid')
                
                # Parse path (collection/rkey)
                path_parts = path.split('/')
                if len(path_parts) != 2:
                    continue
                
                collection, rkey = path_parts
                
                event = {
                    'seq': seq,
                    'did': repo,
                    'collection': collection,
                    'rkey': rkey,
                }
                
                if action == 'create' or action == 'update':
                    # Decode record from blocks
                    record = await self._decode_record(cid, blocks)
                    if record:
                        event['event'] = action
                        event['record'] = record
                        event['cid'] = str(cid) if cid else None
                        return event
                
                elif action == 'delete':
                    event['event'] = 'delete'
                    return event
            
            return None
            
        except Exception as e:
            return None
    
    async def _parse_identity(self, data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Parse identity event (handle change)"""
        seq = data.get('seq')
        if seq:
            self.current_cursor = seq
        
        return {
            'event': 'identity',
            'seq': seq,
            'did': data.get('did'),
            'handle': data.get('handle'),
        }
    
    async def _parse_account(self, data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Parse account event (account status)"""
        seq = data.get('seq')
        if seq:
            self.current_cursor = seq
        
        return {
            'event': 'account',
            'seq': seq,
            'did': data.get('did'),
            'active': data.get('active'),
        }
    
    async def _decode_record(self, cid: Any, blocks: bytes) -> Optional[Dict[str, Any]]:
        """Decode record from CAR blocks"""
        if not cid or not blocks:
            return None
        
        try:
            # Simple CBOR decode from blocks
            # In a full implementation, we'd parse the CAR file format properly
            # For now, try to decode the blocks directly
            record = cbor2.loads(blocks)
            return record
        except:
            # Fallback: return empty dict if we can't decode
            return {}
