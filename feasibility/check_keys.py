"""Verify API keys from .env work. Prints model IDs only, never the keys."""
import os

import anthropic
from dotenv import load_dotenv
from openai import OpenAI

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

print("== Anthropic ==")
if os.getenv("ANTHROPIC_API_KEY"):
    try:
        client = anthropic.Anthropic()
        ids = [m.id for m in client.models.list()]
        print(f"ok: {len(ids)} models:", ", ".join(ids))
    except anthropic.AuthenticationError:
        print("FAILED: key rejected (401)")
    except anthropic.APIError as e:
        print(f"FAILED: {type(e).__name__}: {e}")
else:
    print("ANTHROPIC_API_KEY not set")

print("\n== Nebius Token Factory ==")
if os.getenv("NEBIUS_API_KEY"):
    try:
        nb = OpenAI(base_url="https://api.tokenfactory.nebius.com/v1/", api_key=os.environ["NEBIUS_API_KEY"])
        models = list(nb.models.list())
        print(f"ok: {len(models)} models")
        for m in sorted(models, key=lambda m: m.id):
            print("  ", m.id)
    except Exception as e:  # report and continue; this is a connectivity check
        print(f"FAILED: {type(e).__name__}: {str(e)[:300]}")
else:
    print("NEBIUS_API_KEY not set")
