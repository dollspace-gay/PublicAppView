#!/usr/bin/env python3
"""
AT Protocol Firehose Backfill Tool

A high-performance Python tool for backfilling historical firehose data.
Designed to run separately from the main Node.js application for resource isolation.

Usage:
    python backfill.py --days 30 --workers 4
    python backfill.py --days 7 --start-cursor 12345
    python backfill.py --resume
"""

import asyncio
import os
import sys
import signal
from datetime import datetime, timedelta
from typing import Optional

import click
from rich.console import Console
from rich.progress import Progress, SpinnerColumn, BarColumn, TextColumn, TimeRemainingColumn
from rich.table import Table
from dotenv import load_dotenv

from database import DatabaseAdapter
from firehose_client import FirehoseClient
from event_processor import EventProcessor

console = Console()
load_dotenv()


class BackfillService:
    """Main backfill service orchestrator"""
    
    def __init__(
        self,
        database_url: str,
        relay_url: str,
        days: Optional[int] = None,
        start_cursor: Optional[int] = None,
        workers: int = 4,
        batch_size: int = 100,
    ):
        self.database_url = database_url
        self.relay_url = relay_url
        self.days = days
        self.start_cursor = start_cursor
        self.workers = workers
        self.batch_size = batch_size
        
        self.db: Optional[DatabaseAdapter] = None
        self.firehose: Optional[FirehoseClient] = None
        self.processor: Optional[EventProcessor] = None
        
        self.running = False
        self.cutoff_date: Optional[datetime] = None
        
        # Stats
        self.events_received = 0
        self.events_processed = 0
        self.events_skipped = 0
        self.start_time: Optional[datetime] = None
        
    async def initialize(self):
        """Initialize database and firehose connections"""
        console.print("[bold blue]Initializing backfill service...[/bold blue]")
        
        # Initialize database
        self.db = DatabaseAdapter(self.database_url)
        await self.db.connect()
        console.print("✓ Database connected", style="green")
        
        # Initialize event processor
        self.processor = EventProcessor(self.db)
        console.print("✓ Event processor ready", style="green")
        
        # Calculate cutoff date if days specified
        if self.days and self.days > 0:
            self.cutoff_date = datetime.utcnow() - timedelta(days=self.days)
            console.print(f"✓ Cutoff date: {self.cutoff_date.isoformat()}", style="green")
        elif self.days == -1:
            console.print("✓ Mode: Total backfill (all available history)", style="green")
        else:
            console.print("✓ Mode: No time limit", style="green")
        
        # Initialize firehose client
        cursor = self.start_cursor if self.start_cursor is not None else 0
        self.firehose = FirehoseClient(
            relay_url=self.relay_url,
            start_cursor=cursor,
        )
        console.print(f"✓ Firehose client ready (starting from cursor {cursor})", style="green")
        
    async def run(self):
        """Run the backfill process"""
        self.running = True
        self.start_time = datetime.utcnow()
        
        # Setup signal handlers for graceful shutdown
        def signal_handler(sig, frame):
            console.print("\n[yellow]Received shutdown signal, saving progress...[/yellow]")
            self.running = False
        
        signal.signal(signal.SIGINT, signal_handler)
        signal.signal(signal.SIGTERM, signal_handler)
        
        console.print("\n[bold green]Starting backfill...[/bold green]\n")
        
        # Create progress display
        with Progress(
            SpinnerColumn(),
            TextColumn("[progress.description]{task.description}"),
            BarColumn(),
            TextColumn("[progress.percentage]{task.percentage:>3.0f}%"),
            TextColumn("•"),
            TextColumn("[cyan]{task.fields[received]} received"),
            TextColumn("•"),
            TextColumn("[green]{task.fields[processed]} processed"),
            TextColumn("•"),
            TextColumn("[yellow]{task.fields[skipped]} skipped"),
            TextColumn("•"),
            TextColumn("[blue]{task.fields[rate]}/s"),
            console=console,
        ) as progress:
            
            task = progress.add_task(
                "Backfilling events...",
                total=None,
                received=0,
                processed=0,
                skipped=0,
                rate="0",
            )
            
            # Process events from firehose
            async for event in self.firehose.subscribe():
                if not self.running:
                    break
                
                self.events_received += 1
                
                try:
                    # Check cutoff date if configured
                    should_skip = False
                    if self.cutoff_date and 'record' in event:
                        record = event.get('record', {})
                        created_at = record.get('createdAt')
                        if created_at:
                            try:
                                record_date = datetime.fromisoformat(created_at.replace('Z', '+00:00'))
                                if record_date < self.cutoff_date:
                                    should_skip = True
                            except:
                                pass
                    
                    if should_skip:
                        self.events_skipped += 1
                    else:
                        # Process event
                        await self.processor.process_event(event)
                        self.events_processed += 1
                    
                    # Update progress every 100 events
                    if self.events_received % 100 == 0:
                        elapsed = (datetime.utcnow() - self.start_time).total_seconds()
                        rate = int(self.events_received / elapsed) if elapsed > 0 else 0
                        
                        progress.update(
                            task,
                            received=self.events_received,
                            processed=self.events_processed,
                            skipped=self.events_skipped,
                            rate=f"{rate:,}",
                        )
                    
                    # Save progress every 1000 events
                    if self.events_received % 1000 == 0:
                        await self.save_progress()
                
                except Exception as e:
                    console.print(f"[red]Error processing event: {e}[/red]")
                    # Continue processing other events
        
        # Final progress save
        await self.save_progress()
        
        # Print summary
        await self.print_summary()
        
    async def save_progress(self):
        """Save backfill progress to database"""
        if not self.firehose or not self.db:
            return
        
        cursor = self.firehose.current_cursor
        await self.db.save_backfill_progress(
            cursor=cursor,
            events_processed=self.events_processed,
            last_update_time=datetime.utcnow(),
        )
        
    async def print_summary(self):
        """Print backfill summary"""
        console.print("\n" + "="*60)
        console.print("[bold green]Backfill Complete![/bold green]")
        console.print("="*60)
        
        elapsed = (datetime.utcnow() - self.start_time).total_seconds()
        rate = int(self.events_received / elapsed) if elapsed > 0 else 0
        
        table = Table(show_header=False, box=None)
        table.add_row("Events Received:", f"[cyan]{self.events_received:,}[/cyan]")
        table.add_row("Events Processed:", f"[green]{self.events_processed:,}[/green]")
        table.add_row("Events Skipped:", f"[yellow]{self.events_skipped:,}[/yellow]")
        table.add_row("Duration:", f"[blue]{elapsed:.1f}s[/blue]")
        table.add_row("Average Rate:", f"[magenta]{rate:,} events/sec[/magenta]")
        
        console.print(table)
        console.print("="*60 + "\n")
        
    async def cleanup(self):
        """Cleanup resources"""
        if self.firehose:
            await self.firehose.close()
        if self.db:
            await self.db.close()


@click.command()
@click.option('--days', type=int, default=None, help='Number of days to backfill (0=disabled, -1=all available)')
@click.option('--start-cursor', type=int, default=None, help='Starting cursor position (default: 0)')
@click.option('--workers', type=int, default=4, help='Number of concurrent workers')
@click.option('--batch-size', type=int, default=100, help='Batch size for processing')
@click.option('--resume', is_flag=True, help='Resume from last saved progress')
@click.option('--database-url', envvar='DATABASE_URL', help='PostgreSQL connection URL')
@click.option('--relay-url', envvar='RELAY_URL', default='wss://bsky.network', help='AT Protocol relay URL')
def main(days, start_cursor, workers, batch_size, resume, database_url, relay_url):
    """
    AT Protocol Firehose Backfill Tool
    
    A high-performance tool for backfilling historical firehose data.
    
    Examples:
        # Backfill last 30 days
        python backfill.py --days 30
        
        # Backfill all available history
        python backfill.py --days -1
        
        # Resume from last checkpoint
        python backfill.py --resume
        
        # Start from specific cursor
        python backfill.py --start-cursor 12345 --days 7
    """
    
    # Validate inputs
    if not database_url:
        console.print("[red]Error: DATABASE_URL environment variable not set[/red]")
        sys.exit(1)
    
    # Print banner
    console.print("\n[bold cyan]AT Protocol Firehose Backfill Tool[/bold cyan]")
    console.print("="*60 + "\n")
    
    # Configure based on options
    if resume:
        console.print("[yellow]Resume mode: Will load last saved cursor[/yellow]")
        # TODO: Load last cursor from database
    
    async def run_backfill():
        service = BackfillService(
            database_url=database_url,
            relay_url=relay_url,
            days=days,
            start_cursor=start_cursor,
            workers=workers,
            batch_size=batch_size,
        )
        
        try:
            await service.initialize()
            await service.run()
        except Exception as e:
            console.print(f"[red]Fatal error: {e}[/red]")
            import traceback
            traceback.print_exc()
            sys.exit(1)
        finally:
            await service.cleanup()
    
    # Run the async event loop
    asyncio.run(run_backfill())


if __name__ == '__main__':
    main()
