#!/usr/bin/env python3
"""Capture UI evidence for the OrcaRouter provider in MATKAP's MCP Lab.

Runs the real server from this checkout, drives the real page with Playwright and
writes ``orca-evidence/manifest.json`` plus the screenshots the delivery checks
validate. The OrcaRouter API key is read from the environment by the server and
is never written to disk, the page or this script's output.

Requires: Python Playwright and a Chromium binary (``MATKAP_CHROMIUM`` overrides
``/usr/bin/chromium``). Run from the repository root:

    ORCAROUTER_API_KEY=... python3 test/ui/orca_evidence.py
"""

import datetime
import hashlib
import json
import os
import re
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

REPO_ROOT = Path(__file__).resolve().parents[2]
EVIDENCE_DIR = REPO_ROOT / "orca-evidence"
CATALOG_URL = "https://api.orcarouter.ai/v1/models?capability=chat"
CHROMIUM = os.environ.get("MATKAP_CHROMIUM", "/usr/bin/chromium")


def free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def sha256(path):
    with open(path, "rb") as handle:
        return hashlib.sha256(handle.read()).hexdigest()


def wait_for_server(base, process, timeout=60.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError("MATKAP server exited before it served the page")
        try:
            with urllib.request.urlopen(base + "/", timeout=1) as response:
                if response.status == 200:
                    return
        except (urllib.error.URLError, OSError):
            pass
        time.sleep(0.25)
    raise RuntimeError("MATKAP server did not become ready in time")


def start_server():
    port = free_port()
    env = os.environ.copy()
    env.update(
        PORT=str(port),
        MATKAP_DISABLE_DATABASE="true",
        MATKAP_DISABLE_TELEGRAM="true",
        MATKAP_DISABLE_FEEDS="true",
    )
    log = tempfile.NamedTemporaryFile(prefix="matkap-ui-", suffix=".log", delete=False)
    process = subprocess.Popen(
        ["node", "server.js"],
        cwd=str(REPO_ROOT),
        env=env,
        stdout=log,
        stderr=subprocess.STDOUT,
    )
    log.close()
    base = f"http://127.0.0.1:{port}"
    wait_for_server(base, process)
    return process, base, log.name


def stop_server(process, log_path):
    if process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=10)
    try:
        os.unlink(log_path)
    except OSError:
        pass


def backend_catalog(page, capability):
    """Read the catalog exactly as the page does: through the server boundary."""
    payload = page.evaluate(
        "async (capability) => (await fetch("
        "`/api/ai/models?provider=orcarouter&capability=${capability}`, {cache:'no-store'})).json()",
        capability,
    )
    if not isinstance(payload, dict) or not isinstance(payload.get("models"), list):
        raise RuntimeError(f"model discovery for {capability} returned an unexpected payload")
    return payload


def capture(base):
    assertions = {}
    with sync_playwright() as pw:
        browser = pw.chromium.launch(
            executable_path=CHROMIUM,
            headless=True,
            args=["--no-sandbox", "--no-proxy-server", "--disable-dev-shm-usage"],
        )
        page = browser.new_page(viewport={"width": 1440, "height": 1000}, device_scale_factor=1)
        # The shell links Google Fonts; keep the capture hermetic and fast.
        page.route("**://fonts.googleapis.com/**", lambda route: route.abort())
        page.route("**://fonts.gstatic.com/**", lambda route: route.abort())
        page.goto(base, wait_until="commit")
        page.wait_for_selector("#nav-mcp", timeout=30_000)
        page.click("#nav-mcp")

        page.wait_for_selector("#aiProviders input[data-ai-provider]", timeout=30_000)
        page.click("#aiProviders input[data-ai-provider][value='orcarouter']")
        page.wait_for_selector("#orcaSettings:not([hidden])", timeout=15_000)

        page.wait_for_function(
            "document.querySelectorAll('#orcaModelList [data-model-id]').length > 0",
            timeout=60_000,
        )
        page.wait_for_timeout(500)

        catalog = backend_catalog(page, "chat")
        assert catalog.get("source") == "live", "model discovery did not reach the live catalog"
        assert catalog.get("degraded") is False, "model discovery is degraded; the catalog must be live"
        catalog_ids = [model["id"] for model in catalog["models"]]
        assert catalog_ids, "the live catalog returned no chat models"
        image_catalog = backend_catalog(page, "image")

        # --- auth-methods: the API key entry is this repository's auth method ---
        key_input = page.locator("#orcaApiKeyInput")
        assert key_input.count() == 1, "the API key input is missing"
        assertions["api_key_visible"] = key_input.is_visible()
        assertions["input_type_password"] = key_input.get_attribute("type") == "password"
        status_text = page.locator("#orcaCredentialState").inner_text()
        page_text = page.content()
        assertions["secret_masked"] = bool(
            re.search(r"API key saved \(.+\)", status_text, re.IGNORECASE)
        ) and not re.search(r"sk-orca-[A-Za-z0-9_-]{12,}", page_text)
        assertions["credential_status_text"] = status_text
        assertions["controls_enabled"] = (
            page.locator("#orcaSaveKeyBtn").is_enabled()
            and page.locator("#orcaClearKeyBtn").is_enabled()
            and page.locator("#orcaModelTrigger").is_enabled()
        )
        assertions["model_trigger_label"] = page.locator("#orcaModelValue").inner_text()

        page.locator("#orcaSettings").scroll_into_view_if_needed()
        page.wait_for_timeout(200)
        page.screenshot(path=str(EVIDENCE_DIR / "auth-methods.png"))

        # --- text-model-dropdown: the live catalog, opened ---
        page.locator("#orcaModelTrigger").click()
        page.wait_for_selector("#orcaModelList:not([hidden])", timeout=10_000)
        dropdown_models = page.evaluate(
            "() => [...document.querySelectorAll('#orcaModelList [data-model-id]')]"
            ".map(node => node.dataset.modelId)"
        )
        style = page.evaluate(
            """() => {
                const list = document.querySelector('#orcaModelList');
                const trigger = document.querySelector('#orcaModelTrigger');
                const cs = getComputedStyle(list);
                const lb = list.getBoundingClientRect();
                const tb = trigger.getBoundingClientRect();
                return {
                    background: cs.backgroundColor,
                    borderWidth: cs.borderTopWidth,
                    listVisible: list.offsetParent !== null,
                    rightDelta: Math.abs(lb.right - tb.right),
                };
            }"""
        )
        match = re.match(
            r"rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)",
            style["background"],
        )
        alpha = float(match.group(4)) if match and match.group(4) is not None else 1.0
        assertions["dropdown_open"] = bool(style["listVisible"])
        assertions["item_count"] = len(dropdown_models)
        assertions["opaque_background"] = alpha == 1.0 and style["background"] not in (
            "transparent",
            "rgba(0, 0, 0, 0)",
        )
        assertions["visible_border"] = float(style["borderWidth"].replace("px", "")) > 0
        assertions["trigger_panel_right_delta"] = round(style["rightDelta"], 2)
        assertions["dropdown_matches_catalog"] = dropdown_models == catalog_ids
        assertions["free_text_model_input"] = page.evaluate(
            "() => Boolean(document.querySelector("
            "'#orcaSettings input[type=text], #orcaSettings textarea'))"
        )

        page.screenshot(path=str(EVIDENCE_DIR / "text-model-dropdown.png"))
        browser.close()

    return assertions, catalog_ids, image_catalog


def main():
    if not os.environ.get("ORCAROUTER_API_KEY") and not os.environ.get("ORCA_API_KEY"):
        print("SKIP: ORCAROUTER_API_KEY is not set; the evidence run needs the live catalog.")
        return 2
    EVIDENCE_DIR.mkdir(exist_ok=True)
    # Evidence must describe this run only.
    for name in ("manifest.json", "auth-methods.png", "text-model-dropdown.png"):
        try:
            (EVIDENCE_DIR / name).unlink()
        except FileNotFoundError:
            pass

    process, base, log_path = start_server()
    try:
        assertions, catalog_ids, image_catalog = capture(base)
    finally:
        stop_server(process, log_path)

    assertions["passed"] = all(
        [
            assertions["api_key_visible"],
            assertions["input_type_password"],
            assertions["secret_masked"],
            assertions["controls_enabled"],
            assertions["dropdown_open"],
            assertions["item_count"] == len(catalog_ids) > 0,
            assertions["opaque_background"],
            assertions["visible_border"],
            assertions["trigger_panel_right_delta"] <= 2,
            assertions["dropdown_matches_catalog"],
            assertions["free_text_model_input"] is False,
        ]
    )

    manifest = {
        "automation": {
            "framework": "playwright",
            "passed": assertions["passed"],
            "catalog_source": CATALOG_URL,
            "catalog_model_count": len(catalog_ids),
            "image_model_count": len(image_catalog["models"]),
            "captured_at": datetime.datetime.now(datetime.timezone.utc).strftime(
                "%Y-%m-%dT%H:%M:%SZ"
            ),
        },
        "artifacts": [
            {
                "kind": "auth-methods",
                "path": "auth-methods.png",
                "sha256": sha256(EVIDENCE_DIR / "auth-methods.png"),
                "ui": {
                    "api_key_visible": assertions["api_key_visible"],
                    "secret_masked": assertions["secret_masked"],
                    "controls_enabled": assertions["controls_enabled"],
                },
            },
            {
                "kind": "text-model-dropdown",
                "path": "text-model-dropdown.png",
                "sha256": sha256(EVIDENCE_DIR / "text-model-dropdown.png"),
                "ui": {
                    "dropdown_open": assertions["dropdown_open"],
                    "item_count": assertions["item_count"],
                    "opaque_background": assertions["opaque_background"],
                    "visible_border": assertions["visible_border"],
                    "trigger_panel_right_delta": assertions["trigger_panel_right_delta"],
                },
            },
        ],
    }
    (EVIDENCE_DIR / "manifest.json").write_text(
        json.dumps(manifest, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(manifest["automation"], indent=2))
    print("UI EVIDENCE PASSED" if assertions["passed"] else "UI EVIDENCE FAILED")
    return 0 if assertions["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
