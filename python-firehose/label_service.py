#!/usr/bin/env python3
"""
Label Service for AT Protocol

Applies moderation labels to content.
Python port of server/services/label.ts
"""

import logging
from typing import Optional, List, Dict, Any
from datetime import datetime, timezone
import asyncpg

logger = logging.getLogger(__name__)


class LabelService:
    """Service for managing moderation labels"""
    
    def __init__(self, db_pool):
        self.db_pool = db_pool
        
    async def apply_label(
        self,
        src: str,
        subject: str,
        val: str,
        neg: bool = False,
        created_at: Optional[datetime] = None
    ) -> Dict[str, Any]:
        """Apply a label to a subject"""
        uri = f"at://{src}/app.bsky.labeler.label/{int(datetime.now(timezone.utc).timestamp() * 1000)}"
        created_at = created_at or datetime.now(timezone.utc)
        
        async with self.db_pool.acquire() as conn:
            try:
                # Create label
                await conn.execute(
                    """
                    INSERT INTO labels (uri, src, subject, val, neg, "createdAt")
                    VALUES ($1, $2, $3, $4, $5, $6)
                    ON CONFLICT (uri) DO NOTHING
                    """,
                    uri, src, subject, val, neg, created_at
                )
                
                # Create label event
                await conn.execute(
                    """
                    INSERT INTO "labelEvents" ("labelUri", action, "createdAt")
                    VALUES ($1, $2, NOW())
                    """,
                    uri, 'created'
                )
                
                logger.info(f"[LABEL_SERVICE] Applied label {val} to {subject} from {src}")
                
                return {
                    'uri': uri,
                    'src': src,
                    'subject': subject,
                    'val': val,
                    'neg': neg,
                    'createdAt': created_at
                }
            except Exception as e:
                logger.error(f"[LABEL_SERVICE] Error applying label: {str(e)}")
                raise
                
    async def negate_label(self, src: str, subject: str, val: str) -> Dict[str, Any]:
        """Negate a label (apply as negation)"""
        return await self.apply_label(src, subject, val, neg=True)
        
    async def remove_label(self, uri: str):
        """Remove a label"""
        async with self.db_pool.acquire() as conn:
            try:
                # Get label before deleting
                label = await conn.fetchrow(
                    "SELECT * FROM labels WHERE uri = $1",
                    uri
                )
                
                if label:
                    # Create label event
                    await conn.execute(
                        """
                        INSERT INTO "labelEvents" ("labelUri", action, "createdAt")
                        VALUES ($1, $2, NOW())
                        """,
                        uri, 'deleted'
                    )
                    
                    # Delete label
                    await conn.execute(
                        "DELETE FROM labels WHERE uri = $1",
                        uri
                    )
                    
                    logger.info(f"[LABEL_SERVICE] Removed label {uri}")
            except Exception as e:
                logger.error(f"[LABEL_SERVICE] Error removing label: {str(e)}")
                raise
                
    async def get_labels_for_subject(self, subject: str) -> List[Dict[str, Any]]:
        """Get all labels for a subject"""
        async with self.db_pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT uri, src, subject, val, neg, "createdAt"
                FROM labels
                WHERE subject = $1
                ORDER BY "createdAt" ASC
                """,
                subject
            )
            
            return [dict(row) for row in rows]
            
    async def get_labels_for_subjects(self, subjects: List[str]) -> Dict[str, List[Dict[str, Any]]]:
        """Get all labels for multiple subjects"""
        async with self.db_pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT uri, src, subject, val, neg, "createdAt"
                FROM labels
                WHERE subject = ANY($1::text[])
                ORDER BY "createdAt" ASC
                """,
                subjects
            )
            
            label_map: Dict[str, List[Dict[str, Any]]] = {}
            for row in rows:
                subject = row['subject']
                if subject not in label_map:
                    label_map[subject] = []
                label_map[subject].append(dict(row))
                
            return label_map
            
    async def query_labels(
        self,
        sources: Optional[List[str]] = None,
        subjects: Optional[List[str]] = None,
        values: Optional[List[str]] = None,
        limit: int = 100
    ) -> List[Dict[str, Any]]:
        """Query labels with filters"""
        conditions = []
        params = []
        param_idx = 1
        
        if sources:
            conditions.append(f"src = ANY(${param_idx}::text[])")
            params.append(sources)
            param_idx += 1
            
        if subjects:
            conditions.append(f"subject = ANY(${param_idx}::text[])")
            params.append(subjects)
            param_idx += 1
            
        if values:
            conditions.append(f"val = ANY(${param_idx}::text[])")
            params.append(values)
            param_idx += 1
            
        where_clause = " AND ".join(conditions) if conditions else "1=1"
        params.append(limit)
        
        query = f"""
            SELECT uri, src, subject, val, neg, "createdAt"
            FROM labels
            WHERE {where_clause}
            ORDER BY "createdAt" DESC
            LIMIT ${param_idx}
        """
        
        async with self.db_pool.acquire() as conn:
            rows = await conn.fetch(query, *params)
            return [dict(row) for row in rows]
            
    async def get_active_labels_for_subject(self, subject: str) -> List[Dict[str, Any]]:
        """Get active (non-negated) labels for a subject"""
        labels = await self.get_labels_for_subject(subject)
        return self.filter_negated_labels(labels)
        
    async def get_active_labels_for_subjects(self, subjects: List[str]) -> Dict[str, List[Dict[str, Any]]]:
        """Get active (non-negated) labels for multiple subjects"""
        all_labels = await self.get_labels_for_subjects(subjects)
        
        result = {}
        for subject, labels in all_labels.items():
            result[subject] = self.filter_negated_labels(labels)
            
        return result
        
    def filter_negated_labels(self, labels: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Filter out negated labels"""
        label_map: Dict[str, Dict[str, Any]] = {}
        
        # Sort by createdAt
        sorted_labels = sorted(labels, key=lambda x: x['createdAt'])
        
        for label in sorted_labels:
            key = f"{label['subject']}:{label['val']}"
            
            if label['neg']:
                # Negation removes the label
                label_map.pop(key, None)
            else:
                # Add or update label
                label_map[key] = label
                
        return list(label_map.values())
        
    async def create_label_definition(
        self,
        value: str,
        description: Optional[str] = None,
        severity: str = 'warn',
        localized_strings: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """Create a label definition"""
        async with self.db_pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO "labelDefinitions" (value, description, severity, "localizedStrings")
                VALUES ($1, $2, $3, $4::jsonb)
                ON CONFLICT (value) DO UPDATE SET
                    description = EXCLUDED.description,
                    severity = EXCLUDED.severity,
                    "localizedStrings" = EXCLUDED."localizedStrings"
                """,
                value, description, severity, localized_strings or {}
            )
            
            return {
                'value': value,
                'description': description,
                'severity': severity,
                'localizedStrings': localized_strings or {}
            }
            
    async def get_label_definition(self, value: str) -> Optional[Dict[str, Any]]:
        """Get a label definition"""
        async with self.db_pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                SELECT value, description, severity, "localizedStrings"
                FROM "labelDefinitions"
                WHERE value = $1
                """,
                value
            )
            
            return dict(row) if row else None
            
    async def get_all_label_definitions(self) -> List[Dict[str, Any]]:
        """Get all label definitions"""
        async with self.db_pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT value, description, severity, "localizedStrings"
                FROM "labelDefinitions"
                ORDER BY value
                """
            )
            
            return [dict(row) for row in rows]
