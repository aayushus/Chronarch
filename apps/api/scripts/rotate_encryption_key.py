"""Rotate the envelope encryption key for all stored tokens and secrets.

Re-encrypts:
- Account tokens (access and refresh tokens for connected Google accounts)
- AILiteLLMSettings (stored OpenRouter API keys)
- OAuthProviderConfig (client secrets)

Usage:
    python scripts/rotate_encryption_key.py --new-key <NEW_FERNET_KEY> [--old-key <OLD_KEY>]

If --old-key is omitted, the current TOKEN_ENCRYPTION_KEY from the environment is used.
After rotation completes, update TOKEN_ENCRYPTION_KEY in your .env and restart services:
    docker compose restart api worker scheduler
"""

import argparse
import asyncio
import os
import sys

sys.path.insert(0, ".")

from chronarch_core.crypto import rotate_all_encrypted_data
from chronarch_core.db import SessionLocal


async def run_rotation(old_key: str, new_key: str) -> None:
    if old_key == new_key:
        print("Error: --old-key and --new-key cannot be identical.")
        sys.exit(1)

    print("Starting encryption key rotation...")
    async with SessionLocal() as session:
        try:
            counts = await rotate_all_encrypted_data(session, old_key=old_key, new_key=new_key)
            await session.commit()
            print("\nKey rotation completed successfully!")
            print(f" - Accounts re-encrypted: {counts['accounts_tokens']}")
            print(f" - AI settings keys re-encrypted: {counts['ai_settings_keys']}")
            print(f" - OAuth provider secrets re-encrypted: {counts['oauth_secrets']}")
            print("\nIMPORTANT: Update TOKEN_ENCRYPTION_KEY in your .env and restart services:")
            print("    docker compose restart api worker scheduler")
        except Exception as exc:
            await session.rollback()
            print(f"\nError during key rotation: {exc}")
            print("Transaction rolled back. No database records were altered.")
            sys.exit(1)


def main() -> None:
    parser = argparse.ArgumentParser(description="Rotate Chronarch envelope encryption key.")
    parser.add_argument(
        "--new-key",
        required=True,
        help="The new Fernet encryption key to migrate secrets to.",
    )
    parser.add_argument(
        "--old-key",
        default=os.environ.get("TOKEN_ENCRYPTION_KEY"),
        help="The old Fernet encryption key (defaults to TOKEN_ENCRYPTION_KEY environment variable).",
    )

    args = parser.parse_args()
    if not args.old_key:
        print("Error: No old key provided and TOKEN_ENCRYPTION_KEY is not set.")
        sys.exit(1)

    asyncio.run(run_rotation(args.old_key, args.new_key))


if __name__ == "__main__":
    main()
