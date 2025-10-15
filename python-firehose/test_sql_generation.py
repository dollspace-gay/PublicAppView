#!/usr/bin/env python3
"""Test script to verify SQL generation for post_viewer_states"""

def test_sql_generation():
    """Test the SQL generation logic"""

    test_cases = [
        {
            'name': 'Like only',
            'like_uri': 'at://did:plc:test/app.bsky.feed.like/abc123',
            'repost_uri': None,
            'bookmarked': False
        },
        {
            'name': 'Repost only',
            'like_uri': None,
            'repost_uri': 'at://did:plc:test/app.bsky.feed.repost/xyz789',
            'bookmarked': False
        },
        {
            'name': 'Both like and repost',
            'like_uri': 'at://did:plc:test/app.bsky.feed.like/abc123',
            'repost_uri': 'at://did:plc:test/app.bsky.feed.repost/xyz789',
            'bookmarked': False
        },
        {
            'name': 'Nothing set',
            'like_uri': None,
            'repost_uri': None,
            'bookmarked': False
        },
        {
            'name': 'Bookmarked',
            'like_uri': None,
            'repost_uri': None,
            'bookmarked': True
        }
    ]

    for test in test_cases:
        print(f"\n{'='*60}")
        print(f"Test Case: {test['name']}")
        print(f"{'='*60}")

        like_uri = test['like_uri']
        repost_uri = test['repost_uri']
        bookmarked = test['bookmarked']

        # Simulate the function logic
        updates = []
        insert_params = ['at://post/uri', 'did:plc:viewer']
        param_idx = 3

        # Build VALUES clause with proper parameter handling
        like_param = f'${param_idx}' if like_uri else 'NULL'
        if like_uri:
            insert_params.append(like_uri)
            param_idx += 1

        repost_param = f'${param_idx}' if repost_uri else 'NULL'
        if repost_uri:
            insert_params.append(repost_uri)
            param_idx += 1

        bookmarked_value = 'true' if bookmarked else 'false'

        # Build update clauses
        update_idx = 3
        if like_uri:
            updates.append(f'like_uri = ${update_idx}')
            update_idx += 1

        if repost_uri:
            updates.append(f'repost_uri = ${update_idx}')
            update_idx += 1

        if bookmarked:
            updates.append('bookmarked = true')

        # Generate SQL
        sql = f"""
                INSERT INTO post_viewer_states (post_uri, viewer_did, like_uri, repost_uri, bookmarked, thread_muted, reply_disabled, embedding_disabled, pinned)
                VALUES ($1, $2, {like_param}, {repost_param}, {bookmarked_value}, false, false, false, false)
                ON CONFLICT (post_uri, viewer_did) DO UPDATE SET
                    {', '.join(updates) if updates else 'like_uri = post_viewer_states.like_uri'}
                """

        print(f"\nGenerated SQL:")
        print(sql.strip())
        print(f"\nParameters: {insert_params}")
        print(f"Parameter count: {len(insert_params)}")

        # Check for errors
        if '$NULL' in sql or '$false' in sql or '$true' in sql:
            print("\n❌ ERROR: Found invalid parameter placeholder!")
        else:
            print("\n✅ SQL looks correct!")

if __name__ == '__main__':
    print("Testing SQL Generation for post_viewer_states")
    print("="*60)
    test_sql_generation()
    print("\n" + "="*60)
    print("Test complete!")
