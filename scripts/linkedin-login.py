"""
LinkedIn auto-login script for GTM OS.

Receives credentials via stdin (JSON), uses Patchright to automate
LinkedIn login in the MCP server's persistent browser profile.

Usage:
    echo '{"email": "...", "password": "..."}' | python scripts/linkedin-login.py

Outputs JSON to stdout: {"success": true/false, "message": "..."}
Exit code: 0 on success, 1 on failure.
"""

import asyncio
import json
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path


LINKEDIN_MCP_DIR = Path.home() / ".linkedin-mcp"
PROFILE_DIR = LINKEDIN_MCP_DIR / "profile"
COOKIES_PATH = LINKEDIN_MCP_DIR / "cookies.json"
STATE_PATH = LINKEDIN_MCP_DIR / "source-state.json"

LOGIN_TIMEOUT_MS = 60_000
FEED_URL = "https://www.linkedin.com/feed/"
LOGIN_URL = "https://www.linkedin.com/login"


def output_result(success: bool, message: str) -> None:
    """Print JSON result to stdout and exit."""
    print(json.dumps({"success": success, "message": message}))
    sys.exit(0 if success else 1)


def read_credentials() -> tuple[str, str]:
    """Read email/password from stdin JSON."""
    try:
        raw = sys.stdin.read()
        data = json.loads(raw)
    except (json.JSONDecodeError, ValueError):
        output_result(False, "Invalid JSON on stdin")
        return "", ""  # unreachable, but satisfies type checker

    email = data.get("email", "").strip()
    password = data.get("password", "").strip()

    if not email or not password:
        output_result(False, "Missing email or password in input")
        return "", ""  # unreachable

    return email, password


async def export_cookies(context) -> None:
    """Export browser cookies to cookies.json."""
    cookies = await context.cookies(["https://www.linkedin.com"])
    COOKIES_PATH.parent.mkdir(parents=True, exist_ok=True)
    COOKIES_PATH.write_text(json.dumps(cookies, indent=2), encoding="utf-8")


def update_source_state() -> None:
    """Update source-state.json with a new login generation UUID."""
    state = {
        "cookies_path": str(COOKIES_PATH),
        "created_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "login_generation": str(uuid.uuid4()),
        "profile_path": str(PROFILE_DIR),
        "source_runtime_id": "gtm-agent-auto-login",
        "version": 1,
    }
    STATE_PATH.write_text(json.dumps(state, indent=2), encoding="utf-8")


async def is_logged_in(page) -> bool:
    """Check if we're already logged in by navigating to /feed/."""
    try:
        await page.goto(FEED_URL, wait_until="domcontentloaded", timeout=LOGIN_TIMEOUT_MS)
        # If we end up on /feed/ we're logged in
        return "/feed" in page.url
    except Exception:
        return False


async def perform_login(page, email: str, password: str) -> None:
    """Fill login form and submit."""
    await page.goto(LOGIN_URL, wait_until="domcontentloaded", timeout=LOGIN_TIMEOUT_MS)

    await page.fill('input[id="username"]', email)
    await page.fill('input[id="password"]', password)
    await page.click('button[type="submit"]')

    # Wait for navigation after submit
    await page.wait_for_load_state("domcontentloaded", timeout=LOGIN_TIMEOUT_MS)


def check_for_challenge(url: str) -> bool:
    """Return True if the URL indicates a security challenge."""
    challenge_paths = ["/checkpoint", "/challenge"]
    return any(path in url for path in challenge_paths)


async def main() -> None:
    email, password = read_credentials()

    # Ensure profile directory exists
    PROFILE_DIR.mkdir(parents=True, exist_ok=True)

    try:
        from patchright.async_api import async_playwright
    except ImportError:
        output_result(False, "patchright is not installed (pip install patchright)")
        return

    async with async_playwright() as p:
        context = await p.chromium.launch_persistent_context(
            user_data_dir=str(PROFILE_DIR),
            headless=True,
            args=["--disable-blink-features=AutomationControlled"],
        )

        try:
            page = context.pages[0] if context.pages else await context.new_page()

            # Check if already logged in
            if await is_logged_in(page):
                await export_cookies(context)
                update_source_state()
                output_result(True, "Already logged in")
                return

            # Perform login
            await perform_login(page, email, password)

            # Check for security challenges
            if check_for_challenge(page.url):
                output_result(False, f"Security challenge detected: {page.url}")
                return

            # Verify login succeeded by checking we reached /feed/
            if "/feed" not in page.url:
                # Sometimes there's a redirect delay — wait briefly
                try:
                    await page.wait_for_url("**/feed/**", timeout=10_000)
                except Exception:
                    pass

            if "/feed" not in page.url:
                output_result(False, f"Login failed, ended up at: {page.url}")
                return

            # Success — export cookies and update state
            await export_cookies(context)
            update_source_state()
            output_result(True, "Login successful")

        finally:
            await context.close()


if __name__ == "__main__":
    asyncio.run(main())
