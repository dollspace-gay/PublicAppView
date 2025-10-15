#!/usr/bin/env python3
"""
Verification script - run this inside the Docker container to check if the fix is applied
Usage: docker-compose exec python-backfill-worker python verify_code.py
"""

import inspect
import importlib.util

def check_code():
    """Check if the fixed code is present"""
    print("="*60)
    print("CODE VERIFICATION SCRIPT")
    print("="*60)

    # Load the module
    spec = importlib.util.spec_from_file_location("unified_worker", "/app/unified_worker.py")
    module = importlib.util.module_from_spec(spec)

    try:
        spec.loader.exec_module(module)
        print("\n✓ Module loaded successfully")
    except Exception as e:
        print(f"\n✗ Failed to load module: {e}")
        return

    # Get the source code of create_post_viewer_state
    try:
        source = inspect.getsource(module.UnifiedWorker.create_post_viewer_state)
        print("\n" + "="*60)
        print("SOURCE CODE OF create_post_viewer_state:")
        print("="*60)
        print(source[:1000])  # Print first 1000 chars

        # Check for the problematic patterns
        if "$NULL" in source or "$false" in source or ".replace" in source:
            print("\n❌ OLD CODE DETECTED!")
            print("The container is running the OLD buggy code.")
            print("Found problematic patterns:")
            if "$NULL" in source:
                print("  - Found '$NULL'")
            if "$false" in source:
                print("  - Found '$false'")
            if ".replace" in source:
                print("  - Found '.replace'")
        elif "{like_param}" in source and "{repost_param}" in source:
            print("\n✅ NEW CODE DETECTED!")
            print("The container is running the FIXED code.")
        else:
            print("\n⚠ UNKNOWN CODE VERSION")
            print("Cannot determine if this is the old or new code.")

    except Exception as e:
        print(f"\n✗ Failed to get source: {e}")

if __name__ == '__main__':
    check_code()
