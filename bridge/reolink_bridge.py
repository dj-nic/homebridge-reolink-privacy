#!/usr/bin/env python3
"""Small JSON-lines adapter around reolink-aio's maintained Baichuan implementation."""
import asyncio
import json
import logging
import os
import sys

from reolink_aio.api import Host
from reolink_aio.enums import ConnectionEnum

logging.disable(logging.CRITICAL)  # stdout remains a machine-only JSON channel; no credentials are logged.


def new_host() -> Host:
    return Host(
        host=os.environ["HB_REOLINK_HOST"],
        username=os.environ["HB_REOLINK_USERNAME"],
        password=os.environ["HB_REOLINK_PASSWORD"],
        bc_port=int(os.environ.get("HB_REOLINK_PORT", "9000")),
        bc_only=True,
        bc_connection=ConnectionEnum.tcp,
        timeout=10,
    )


async def run() -> None:
    host = new_host()

    try:
        while True:
            line = await asyncio.to_thread(sys.stdin.readline)
            if not line:
                break
            command = {}
            try:
                command = json.loads(line)
                request_id = int(command["id"])
                action = command["action"]
                if action == "set":
                    if not isinstance(command.get("enabled"), bool):
                        raise ValueError("enabled must be a boolean")
                    await host.baichuan.set_privacy_mode(channel=0, enable=command["enabled"])
                elif action == "get":
                    await host.baichuan.get_privacy_mode(channel=0)
                else:
                    raise ValueError("unsupported action")

                state = host.baichuan.privacy_mode(0)
                if not isinstance(state, bool):
                    raise RuntimeError("camera returned no Privacy Mode state")
                response = {"id": request_id, "ok": True, "enabled": state}
            except Exception as exc:  # Return only the exception class, never raw messages or credentials.
                response = {
                    "id": command.get("id", -1) if isinstance(command, dict) else -1,
                    "ok": False,
                    "error": f"Camera request failed ({type(exc).__name__})",
                }
                # Discard a possibly stale socket/session so the next request starts a fresh login.
                try:
                    await host.logout()
                except Exception:
                    pass
                host = new_host()
            sys.stdout.write(json.dumps(response, separators=(",", ":")) + "\n")
            sys.stdout.flush()
    finally:
        try:
            await host.logout()
        except Exception:
            pass


if __name__ == "__main__":
    asyncio.run(run())
