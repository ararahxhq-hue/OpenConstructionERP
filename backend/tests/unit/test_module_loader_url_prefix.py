# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
#
# Regression test for the module-loader URL-prefix derivation.
#
# Background: the recently-added 18 modules were shipped with frontend
# api.ts files that hit hyphenated paths like ``/api/v1/bi-dashboards``
# and ``/api/v1/hse-advanced``. The loader, however, derived the URL
# prefix straight from the Python package directory name (which uses
# underscores) — so the frontend got a 404 on every request and the
# user reported pages like /bi-dashboards and /hse-advanced as "не
# работает полностью" (completely broken).
#
# The fix mounts the router on the kebab-cased path AND mirrors it
# under the legacy underscore form for backward compatibility. This
# test pins both behaviours against the real on-disk ``bi_dashboards``
# and ``hse_advanced`` modules so a future loader refactor cannot
# silently regress the public URL surface.

from __future__ import annotations

import asyncio
import importlib
import sys

from fastapi import FastAPI


def _mounted_paths(app: FastAPI, prefix: str) -> list[str]:
    return [getattr(route, "path", "") for route in app.routes if getattr(route, "path", "").startswith(prefix)]


def _rebuild_router_module(module_name: str) -> None:
    """Force a clean rebuild of the target module's ``router`` submodule.

    Why this is needed (CI-only, sharding-dependent):
    ``_load_module`` mounts ``app.modules.<dir>.router.router`` exactly as it
    finds it in ``sys.modules`` and never reloads it (correct for production,
    where every module is imported once at startup). Under ``pytest-split`` a
    different slice of the unit suite lands in each shard, so an unrelated test
    that ran earlier in the same worker can leave one of these router modules
    cached in a state where ``router`` is missing or its ``routes`` list is
    empty - making ``_load_module`` mount zero routes here even though the very
    same run passes unsharded (different ordering). This regression test pins
    the loader's URL-prefix derivation, not whatever happens to be cached, so
    we rebuild the router from source first to stay hermetic.

    Only the ``router`` submodule is reloaded (plus the package itself if it
    was never imported). We deliberately do NOT touch the ``.models`` submodule
    or any other SQLAlchemy-mapped module: reloading a models module re-runs
    ``class X(Base)`` and raises "Table already defined for this MetaData".
    Reloading ``router.py`` only re-executes ``router = APIRouter()`` and the
    ``@router.<verb>`` decorators; its ``from .models import ...`` lines simply
    re-bind names from the already-cached (untouched) models module, so no ORM
    table is ever redefined.
    """
    dir_name = module_name.removeprefix("oe_")
    package_path = f"app.modules.{dir_name}"
    router_module_name = f"{package_path}.router"
    # Ensure the package and router module exist in sys.modules, then reload the
    # router so it is rebuilt from source (never del + reimport).
    importlib.import_module(package_path)
    router_mod = importlib.import_module(router_module_name)
    importlib.reload(router_mod)
    # Sanity: the rebuilt module must expose a populated router. If it does not,
    # something is wrong with the module itself (not stale cache) and we want a
    # clear failure rather than a misleading empty-routes assertion downstream.
    rebuilt = sys.modules[router_module_name]
    assert getattr(getattr(rebuilt, "router", None), "routes", None), (
        f"{router_module_name} did not rebuild a populated router"
    )


def _load_real_module(module_name: str) -> FastAPI:
    """Load a real backend module into a fresh FastAPI app and return it."""
    from app.core.module_loader import ModuleLoader

    _rebuild_router_module(module_name)
    loader = ModuleLoader()
    loader.discover()
    app = FastAPI()
    asyncio.run(loader._load_module(module_name, app))
    return app


def test_bi_dashboards_mounted_on_kebab_case() -> None:
    """``bi_dashboards`` package must serve under ``/api/v1/bi-dashboards``."""
    app = _load_real_module("oe_bi_dashboards")
    paths = _mounted_paths(app, "/api/v1/bi-dashboards/")
    assert paths, (
        "BI dashboards router must mount under /api/v1/bi-dashboards/* (frontend api.ts uses this kebab-case prefix)."
    )
    # Specifically the create endpoint that was failing for the user.
    assert any(p == "/api/v1/bi-dashboards/dashboards" for p in paths), (
        f"Missing POST /api/v1/bi-dashboards/dashboards: {paths!r}"
    )


def test_bi_dashboards_legacy_underscore_mirror() -> None:
    """The underscore form is mirrored for callers that haven't migrated."""
    app = _load_real_module("oe_bi_dashboards")
    paths = _mounted_paths(app, "/api/v1/bi_dashboards/")
    assert paths, (
        "Legacy /api/v1/bi_dashboards mirror is missing — third-party "
        "callers that have not migrated to the kebab-case URL would 404."
    )


def test_hse_advanced_mounted_on_kebab_case() -> None:
    """``hse_advanced`` package must serve under ``/api/v1/hse-advanced``."""
    app = _load_real_module("oe_hse_advanced")
    paths = _mounted_paths(app, "/api/v1/hse-advanced/")
    assert paths, paths
    # Investigations list endpoint added during the same fix.
    assert any(p == "/api/v1/hse-advanced/investigations/" for p in paths), (
        f"Missing GET /api/v1/hse-advanced/investigations/: {paths!r}"
    )


def test_schedule_advanced_mounted_on_kebab_case() -> None:
    """``schedule_advanced`` package must serve under
    ``/api/v1/schedule-advanced`` — the user's "create doesn't work"
    on /schedule-advanced was caused by this URL mismatch.
    """
    app = _load_real_module("oe_schedule_advanced")
    paths = _mounted_paths(app, "/api/v1/schedule-advanced/")
    assert paths, paths
    assert any(p == "/api/v1/schedule-advanced/master-schedules/" for p in paths), (
        f"Missing POST /api/v1/schedule-advanced/master-schedules/: {paths!r}"
    )
