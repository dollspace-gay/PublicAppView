#!/usr/bin/env python3
"""
Backfill Service for AT Protocol
Python implementation based on TypeScript backfill.ts

This service provides historical data backfilling capabilities for the AT Protocol worker.
It can backfill:
- A specific number of days of historical data
- Total backfill (entire available history with -1)
- Resume from a saved cursor position
"""

import asyncio
import logging
import os
import signal
import sys
import time
import psutil
import threading
from datetime import datetime, timedelta, timezone
from typing import Optional, Dict, Any
from atproto import FirehoseSubscribeReposClient, parse_subscribe_repos_message, firehose_models, models

# Import event processor and database components
from unified_worker import EventProcessor, DatabasePool
from did_resolver import did_resolver
from pds_data_fetcher import PDSDataFetcher
from label_service import LabelService

# Set up logging
logger = logging.getLogger(__name__)


class BackfillProgress:
    """Track backfill progress and statistics"""
    
    def __init__(self):
        self.start_cursor: Optional[int] = None
        self.current_cursor: Optional[int] = None
        self.events_processed: int = 0
        self.events_skipped: int = 0
        self.events_received: int = 0
        self.start_time: datetime = datetime.now(timezone.utc)
        self.last_update_time: datetime = datetime.now(timezone.utc)
        self.estimated_completion: Optional[datetime] = None
        self.is_running: bool = False
        
        # Memory and performance tracking
        self.queue_depth: int = 0
        self.active_processing: int = 0


class BackfillService:
    """
    Historical data backfill service for AT Protocol
    
    Features:
    - Configurable backfill duration (days or total history)
    - Resume from saved cursor position
    - Resource throttling for background processing
    - Memory management and monitoring
    - Progress tracking and persistence
    """
    
    # Default configuration
    PROGRESS_SAVE_INTERVAL = 1000  # Save progress every 1000 events
    MAX_EVENTS_PER_RUN = 1000000  # Safety limit for total backfill
    
    def __init__(
        self,
        database_url: str,
        relay_url: str = None,
        db_pool_size: int = 10  # Smaller pool for backfill
    ):
        self.database_url = database_url
        self.relay_url = relay_url or os.getenv("RELAY_URL", "wss://bsky.network/xrpc/com.atproto.sync.subscribeRepos")
        self.db_pool_size = db_pool_size
        
        # Initialize components
        self.db_pool: Optional[DatabasePool] = None
        self.event_processor: Optional[EventProcessor] = None
        self.client: Optional[FirehoseSubscribeReposClient] = None
        self.is_running = False
        self.progress = BackfillProgress()
        
        # Backfill configuration from environment
        backfill_days_raw = os.getenv("BACKFILL_DAYS", "0")
        try:
            self.backfill_days = int(backfill_days_raw)
            if self.backfill_days < -1:
                self.backfill_days = 0
        except ValueError:
            logger.warning(f"Invalid BACKFILL_DAYS value '{backfill_days_raw}' - using default (0)")
            self.backfill_days = 0
        
        self.cutoff_date: Optional[datetime] = None
        
        # Resource throttling configuration
        self.BATCH_SIZE = int(os.getenv("BACKFILL_BATCH_SIZE", "5"))
        self.BATCH_DELAY_MS = int(os.getenv("BACKFILL_BATCH_DELAY_MS", "2000"))
        self.MAX_CONCURRENT_PROCESSING = int(os.getenv("BACKFILL_MAX_CONCURRENT", "2"))
        self.MAX_MEMORY_MB = int(os.getenv("BACKFILL_MAX_MEMORY_MB", "512"))
        self.USE_IDLE_PROCESSING = os.getenv("BACKFILL_USE_IDLE", "true").lower() != "false"
        
        # Performance tracking
        self.batch_counter = 0
        self.last_memory_check = 0
        self.memory_paused = False
        self.active_processing = 0
        self.processing_queue = []
        
        # Log configuration
        logger.info("[BACKFILL] Resource throttling config:")
        logger.info(f"  - Batch size: {self.BATCH_SIZE} events")
        logger.info(f"  - Batch delay: {self.BATCH_DELAY_MS}ms")
        logger.info(f"  - Max concurrent: {self.MAX_CONCURRENT_PROCESSING}")
        logger.info(f"  - Memory limit: {self.MAX_MEMORY_MB}MB")
        logger.info(f"  - Idle processing: {self.USE_IDLE_PROCESSING}")
    
    async def initialize(self):
        """Initialize database connection and services"""
        logger.info("[BACKFILL] Initializing backfill service...")
        
        # Create database pool
        self.db_pool = DatabasePool(self.database_url, self.db_pool_size)
        await self.db_pool.connect()
        
        # Initialize services
        await did_resolver.initialize()
        
        pds_data_fetcher = PDSDataFetcher(self.db_pool)
        await pds_data_fetcher.initialize()
        
        label_service = LabelService(self.db_pool)
        
        # Create event processor with backfill-specific configuration
        self.event_processor = EventProcessor(self.db_pool)
        
        # Wire up services
        self.event_processor.pds_data_fetcher = pds_data_fetcher
        self.event_processor.label_service = label_service
        pds_data_fetcher.event_processor = self.event_processor
        
        # Disable signature verification for faster backfill
        # Note: This is handled in the message processing
        
        logger.info("[BACKFILL] Backfill service initialized")
    
    async def start(self, start_cursor: Optional[int] = None):
        """Start the backfill process"""
        if self.is_running:
            raise RuntimeError("Backfill is already running")
        
        if self.backfill_days == 0:
            logger.info("[BACKFILL] Backfill is disabled (BACKFILL_DAYS=0)")
            return
        
        # Configure backfill mode
        if self.backfill_days == -1:
            backfill_mode = "TOTAL (entire available history)"
            self.cutoff_date = None
        else:
            backfill_mode = f"{self.backfill_days} days"
            self.cutoff_date = datetime.now(timezone.utc) - timedelta(days=self.backfill_days)
        
        logger.info(f"[BACKFILL] Starting {backfill_mode} historical backfill...")
        if self.cutoff_date:
            logger.info(f"[BACKFILL] Cutoff date: {self.cutoff_date.isoformat()}")
        
        self.is_running = True
        self.batch_counter = 0
        
        # Initialize progress
        self.progress = BackfillProgress()
        self.progress.start_cursor = start_cursor
        self.progress.current_cursor = start_cursor
        self.progress.is_running = True
        
        try:
            # Clear any saved progress when starting a new backfill
            logger.info("[BACKFILL] Starting fresh backfill from cursor 0 to fetch full historical window")
            self.progress.current_cursor = None
            self.progress.events_processed = 0
            
            await self.run_backfill()
            logger.info("[BACKFILL] Backfill completed successfully")
        except Exception as e:
            logger.error(f"[BACKFILL] Error during backfill: {e}", exc_info=True)
            self.is_running = False
            self.progress.is_running = False
            raise
    
    async def run_backfill(self):
        """Main backfill loop"""
        # Configure start cursor
        if self.backfill_days == -1:
            # Total backfill: start from oldest available (seq 0)
            start_cursor = 0
            logger.info("[BACKFILL] Using startCursor=0 for total backfill (entire rollback window)")
        elif self.progress.current_cursor is not None:
            # Resume from saved position
            start_cursor = self.progress.current_cursor
            logger.info(f"[BACKFILL] Resuming from saved cursor: {start_cursor}")
        else:
            # Start from oldest available
            start_cursor = 0
            logger.info("[BACKFILL] Using startCursor=0 to fetch available history")
        
        # Create firehose client with cursor
        logger.info("[BACKFILL] Creating Firehose client...")
        
        # Track expected sequence for filtering
        self.current_expected_seq = start_cursor if start_cursor > 0 else None
        
        # Create client with cursor parameter if resuming
        params = None
        if start_cursor and start_cursor > 0:
            params = models.ComAtprotoSyncSubscribeRepos.Params(cursor=start_cursor)
            logger.info(f"[BACKFILL] Resuming from cursor: {start_cursor}")
        
        self.client = FirehoseSubscribeReposClient(params)
        
        # Get the current event loop for scheduling tasks
        main_loop = asyncio.get_event_loop()
        
        # Set up synchronous message handler that schedules work on the main loop
        def on_message_handler(message: firehose_models.MessageFrame):
            """Handle incoming firehose message (synchronous)."""
            try:
                # Schedule the async processing on the main event loop
                # Use call_soon_threadsafe since client.start() runs in a thread
                asyncio.run_coroutine_threadsafe(
                    self.process_message(message),
                    main_loop
                )
            except Exception as e:
                logger.error(f"[BACKFILL] Error scheduling message processing: {e}")
        
        logger.info("[BACKFILL] Starting Firehose client in background thread...")
        
        # Run the blocking client.start() in a separate thread
        # This allows the main event loop to continue processing async tasks
        client_thread = threading.Thread(
            target=lambda: self.client.start(on_message_handler),
            daemon=True,
            name="FirehoseClientThread"
        )
        client_thread.start()
        logger.info("[BACKFILL] Firehose client thread started")
        
        # Keep the async function running while backfill is active
        # This allows the event loop to process the scheduled async tasks
        try:
            while self.is_running and client_thread.is_alive():
                await asyncio.sleep(1)
                # Periodic status check
                if self.progress.events_received > 0 and self.progress.events_received % 10000 == 0:
                    logger.debug(f"[BACKFILL] Thread alive, processed {self.progress.events_processed} events")
        except Exception as e:
            logger.error(f"[BACKFILL] Error in main loop: {e}")
            raise
        finally:
            # Clean up
            if self.client:
                try:
                    self.client.stop()
                except:
                    pass
    
    async def process_message(self, message: firehose_models.MessageFrame):
        """Process a single firehose message"""
        try:
            # Track all received events
            self.progress.events_received += 1
            
            # Parse message
            commit = parse_subscribe_repos_message(message)
            
            # Track sequence number if available
            if hasattr(commit, 'seq') and commit.seq is not None:
                self.progress.current_cursor = commit.seq
                
                # Skip if we haven't reached our start cursor yet
                if self.current_expected_seq is not None and commit.seq < self.current_expected_seq:
                    return
            
            # Handle different event types
            if isinstance(commit, models.ComAtprotoSyncSubscribeRepos.Commit):
                # Check cutoff date for create/update events
                skip_old_events = False
                if self.cutoff_date:
                    # Extract records from commit to check dates
                    for op in commit.ops:
                        if hasattr(op, 'record') and op.record:
                            record_data = op.record
                            if isinstance(record_data, dict) and 'createdAt' in record_data:
                                try:
                                    record_date = datetime.fromisoformat(record_data['createdAt'].replace('Z', '+00:00'))
                                    if record_date < self.cutoff_date:
                                        skip_old_events = True
                                        break
                                except:
                                    pass
                
                if skip_old_events:
                    self.progress.events_skipped += 1
                    return
                
                # Process commit
                await self.event_processor.process_commit(commit)
                
            elif isinstance(commit, models.ComAtprotoSyncSubscribeRepos.Identity):
                # Process identity event
                event_data = {
                    'did': commit.did,
                    'handle': commit.handle,
                }
                await self.event_processor.process_identity(event_data)
                
            elif isinstance(commit, models.ComAtprotoSyncSubscribeRepos.Account):
                # Process account event
                event_data = {
                    'did': commit.did,
                    'active': commit.active,
                }
                await self.event_processor.process_account(event_data)
            
            # Update progress
            self.progress.events_processed += 1
            self.progress.last_update_time = datetime.now(timezone.utc)
            self.batch_counter += 1
            
            # Memory check and throttling
            if self.progress.events_processed % 100 == 0:
                await self.check_memory_and_throttle()
            
            # Batch delay to prevent resource overload
            if self.batch_counter >= self.BATCH_SIZE:
                if self.USE_IDLE_PROCESSING:
                    # Yield to other tasks
                    await asyncio.sleep(0)
                # Always add the configured delay
                await asyncio.sleep(self.BATCH_DELAY_MS / 1000)
                self.batch_counter = 0
            
            # Log progress periodically
            if self.progress.events_received % self.PROGRESS_SAVE_INTERVAL == 0:
                elapsed = (datetime.now(timezone.utc) - self.progress.start_time).total_seconds()
                rate = self.progress.events_received / elapsed if elapsed > 0 else 0
                logger.info(
                    f"[BACKFILL] Progress: {self.progress.events_received} received, "
                    f"{self.progress.events_processed} processed, "
                    f"{self.progress.events_skipped} skipped ({rate:.0f} evt/s)"
                )
                await self.save_progress()
            
            # Check safety limit
            if self.progress.events_processed >= self.MAX_EVENTS_PER_RUN:
                logger.info(f"[BACKFILL] Reached safety limit of {self.MAX_EVENTS_PER_RUN} events")
                await self.stop()
                
        except Exception as e:
            # Check for duplicate key errors (common during backfill)
            if "duplicate key value" in str(e):
                # Skip silently
                pass
            else:
                logger.error(f"[BACKFILL] Error processing event: {e}")
    
    async def check_memory_and_throttle(self):
        """Check memory usage and throttle if necessary"""
        try:
            # Get current process memory usage
            process = psutil.Process()
            memory_info = process.memory_info()
            heap_used_mb = memory_info.rss / 1024 / 1024  # RSS in MB
            
            # Check if we're exceeding memory limit
            if heap_used_mb > self.MAX_MEMORY_MB:
                if not self.memory_paused:
                    logger.warning(
                        f"[BACKFILL] Memory usage high ({heap_used_mb:.0f}MB > {self.MAX_MEMORY_MB}MB), "
                        "pausing for GC..."
                    )
                    self.memory_paused = True
                
                # Wait for memory to be freed
                await asyncio.sleep(5)
                
                # Check again
                memory_info = process.memory_info()
                new_heap_used_mb = memory_info.rss / 1024 / 1024
                
                if new_heap_used_mb < self.MAX_MEMORY_MB:
                    logger.info(f"[BACKFILL] Memory recovered ({new_heap_used_mb:.0f}MB), resuming...")
                    self.memory_paused = False
                else:
                    # Still high, wait longer
                    logger.warning(f"[BACKFILL] Memory still high ({new_heap_used_mb:.0f}MB), waiting longer...")
                    await asyncio.sleep(10)
                    self.memory_paused = False
            elif self.memory_paused:
                # Memory back to normal
                logger.info(f"[BACKFILL] Memory usage normal ({heap_used_mb:.0f}MB), resuming...")
                self.memory_paused = False
            
            # Log memory usage periodically
            if self.progress.events_processed % 10000 == 0:
                logger.info(f"[BACKFILL] Memory: {heap_used_mb:.0f}MB / {self.MAX_MEMORY_MB}MB limit")
                
        except Exception as e:
            logger.error(f"[BACKFILL] Error checking memory: {e}")
    
    async def save_progress(self):
        """Save backfill progress to database"""
        try:
            async with self.db_pool.acquire() as conn:
                # Upsert progress to firehose_cursor table
                await conn.execute("""
                    INSERT INTO firehose_cursor (service, cursor, last_event_time, updated_at)
                    VALUES ($1, $2, $3, NOW())
                    ON CONFLICT (service) 
                    DO UPDATE SET 
                        cursor = EXCLUDED.cursor,
                        last_event_time = EXCLUDED.last_event_time,
                        updated_at = NOW()
                """, 
                "backfill", 
                str(self.progress.current_cursor) if self.progress.current_cursor else None,
                self.progress.last_update_time
                )
        except Exception as e:
            logger.error(f"[BACKFILL] Error saving progress: {e}")
    
    async def get_saved_progress(self) -> Optional[Dict[str, Any]]:
        """Load saved backfill progress from database"""
        try:
            async with self.db_pool.acquire() as conn:
                row = await conn.fetchrow("""
                    SELECT cursor, last_event_time 
                    FROM firehose_cursor 
                    WHERE service = $1
                """, "backfill")
                
                if row:
                    return {
                        'cursor': int(row['cursor']) if row['cursor'] else None,
                        'last_event_time': row['last_event_time']
                    }
        except Exception as e:
            logger.error(f"[BACKFILL] Error loading progress: {e}")
        
        return None
    
    async def stop(self):
        """Stop the backfill service"""
        logger.info("[BACKFILL] Stopping backfill...")
        
        if self.client:
            try:
                self.client.stop()
            except:
                pass
            self.client = None
        
        await self.save_progress()
        self.is_running = False
        self.progress.is_running = False
        
        logger.info("[BACKFILL] Backfill stopped")
        logger.info(f"[BACKFILL] Final stats: {self.progress.events_processed} events processed")
    
    def get_progress(self) -> BackfillProgress:
        """Get current progress information"""
        # Update queue depth and active processing count
        self.progress.queue_depth = len(self.processing_queue)
        self.progress.active_processing = self.active_processing
        return self.progress
    
    async def cleanup(self):
        """Clean up resources"""
        if self.is_running:
            await self.stop()
        
        # Close services
        if self.event_processor and self.event_processor.pds_data_fetcher:
            await self.event_processor.pds_data_fetcher.close()
        
        await did_resolver.close()
        
        if self.db_pool:
            await self.db_pool.close()


async def main():
    """Main entry point for standalone backfill"""
    # Configure logging
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
        handlers=[
            logging.StreamHandler(sys.stdout)
        ]
    )
    
    # Get configuration
    database_url = os.getenv("DATABASE_URL", "postgresql://postgres:password@localhost:5432/atproto")
    relay_url = os.getenv("RELAY_URL", "wss://bsky.network/xrpc/com.atproto.sync.subscribeRepos")
    backfill_days = int(os.getenv("BACKFILL_DAYS", "0"))
    
    if backfill_days == 0:
        logger.info("[BACKFILL] Backfill is disabled (BACKFILL_DAYS=0)")
        return
    
    logger.info("=" * 60)
    logger.info("AT Protocol Backfill Service (Python)")
    logger.info("=" * 60)
    logger.info(f"Relay URL:       {relay_url}")
    logger.info(f"Backfill days:   {backfill_days} {'(total history)' if backfill_days == -1 else ''}")
    logger.info("=" * 60)
    
    # Create and initialize service
    service = BackfillService(database_url, relay_url)
    await service.initialize()
    
    # Set up signal handlers
    def signal_handler(signum, frame):
        logger.info(f"Received signal {signum}, shutting down...")
        asyncio.create_task(service.stop())
    
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)
    
    try:
        # Start backfill
        await service.start()
    except KeyboardInterrupt:
        logger.info("Keyboard interrupt received")
    except Exception as e:
        logger.error(f"Fatal error: {e}", exc_info=True)
        sys.exit(1)
    finally:
        await service.cleanup()


if __name__ == "__main__":
    asyncio.run(main())