#!/usr/bin/env python3
"""Staging ↔ prod parity guard (docs/staging-env.md, T2).

Sub-commands:

  check     Compare environments/prod/terraform.tfvars with environments/staging/terraform.tfvars,
            resolving variable defaults from variables.tf when a key is absent. Fails on any
            difference not in ALLOWED_DEVIATIONS, and on any staging safety rule violation.
  effective Print the effective (tfvars + defaults) values of one environment as JSON.
  live      Read the LIVE prod settings with `az` (SQL SKU, Container App size/scale, Log
            Analytics) and compare them with what the staging tfvars + main.tf will create.
            The SQL tier was once changed by hand in the Portal, so tfvars alone can't be trusted.

Only the standard library is used, so CI needs nothing but python3 (and `az` for `live`).
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
INFRA = REPO_ROOT / "infrastructure_v2"

# §2.2 of the plan: the only keys allowed to differ between prod and staging. Everything else
# that a variable can set — sizing, scale, schedules, retention, quotas, region, flags — must match.
ALLOWED_DEVIATIONS = {
    "subscription_id": "staging lives in the dev subscription",
    "environment": "RG and resource naming",
    "sifen_environment": "staging must never send real fiscal documents (must be TEST)",
    "key_vault_soft_delete_retention_days": "disposable vault must be purgeable",
    "key_vault_purge_protection_enabled": "purge protection is irreversible",
    "frontend_custom_domains": "flowbit.tech belongs to prod",
    "website_swa_name": "flowbit.tech belongs to prod",
    "website_swa_resource_group": "flowbit.tech belongs to prod",
    "website_custom_domain": "flowbit.tech belongs to prod",
    "email_custom_domain": "prod's sender domain must not be used (and can't be verified) from staging",
    "email_domain_verification_enabled": "follows email_custom_domain",
    "stock_api_base_url": "staging must never call a real Stock system (must stay empty)",
    "manage_resource_providers": "the dev state owns the subscription's provider registrations",
    "ci_deployer_principal_id": "staging's RG is recreated, so the CI grant lives in its state",
    "deployer_ip": "operator machine (same variable as dev)",
    "entra_sql_admin_login": "same Entra group as dev",
    "entra_sql_admin_object_id": "same Entra group as dev",
    "tags": "cosmetic",
}


def _staging_rules(v: dict) -> list[str]:
    """Hard safety rules on the staging values themselves (not a comparison)."""
    errors = []

    def want(key, expected, why):
        if v.get(key) != expected:
            errors.append(f"staging {key} = {v.get(key)!r}, must be {expected!r} ({why})")

    want("environment", "staging", "resource naming")
    want("sifen_environment", "TEST", "never PRODUCTION")
    want("manage_resource_providers", False, "a staging destroy would unregister Microsoft.App")
    want("key_vault_purge_protection_enabled", False, "down.sh must be able to purge the vault")
    want("frontend_custom_domains", [], "flowbit.tech belongs to prod")
    want("website_custom_domain", "", "flowbit.tech belongs to prod")
    want("email_custom_domain", "", "AzureManaged sender domain only")
    want("stock_api_base_url", "", "no Stock calls from staging")
    return errors


# ---------------------------------------------------------------------------------------------
# Minimal HCL value parsing (tfvars + `default =` in variables.tf). Supports what this repo uses:
# strings, numbers, bools, null, single- or multi-line lists of scalars, and `{}` maps.
# ---------------------------------------------------------------------------------------------


def _strip_comment(line: str) -> str:
    out, in_str, esc = [], False, False
    i = 0
    while i < len(line):
        c = line[i]
        if in_str:
            out.append(c)
            if esc:
                esc = False
            elif c == "\\":
                esc = True
            elif c == '"':
                in_str = False
        else:
            if c == '"':
                in_str = True
                out.append(c)
            elif c == "#" or line.startswith("//", i):
                break
            else:
                out.append(c)
        i += 1
    return "".join(out).rstrip()


def _parse_value(text: str):
    text = text.strip()
    if text.startswith('"'):
        return json.loads(text)
    if text in ("true", "false"):
        return text == "true"
    if text == "null":
        return None
    if text.startswith("["):
        inner = text[1:-1].strip()
        if not inner:
            return []
        items = [p.strip() for p in re.findall(r'"(?:[^"\\]|\\.)*"|[^,\s]+', inner)]
        return [_parse_value(p) for p in items if p]
    if text.startswith("{"):
        inner = text[1:-1].strip()
        result = {}
        for m in re.finditer(r'"?([\w.-]+)"?\s*=\s*("(?:[^"\\]|\\.)*"|[^,\s}]+)', inner):
            result[m.group(1)] = _parse_value(m.group(2))
        return result
    try:
        return int(text)
    except ValueError:
        return float(text)


def _collect(lines, i, first):
    """Join a multi-line [ ... ] / { ... } value starting at lines[i]."""
    buf = first
    opener = first.strip()[0]
    closer = "]" if opener == "[" else "}"
    depth = buf.count(opener) - buf.count(closer)
    while depth > 0:
        i += 1
        nxt = _strip_comment(lines[i])
        buf += " " + nxt.strip()
        depth += nxt.count(opener) - nxt.count(closer)
    return buf, i


def parse_tfvars(path: Path) -> dict:
    values = {}
    lines = path.read_text().splitlines()
    i = 0
    while i < len(lines):
        line = _strip_comment(lines[i])
        m = re.match(r"^\s*([A-Za-z_][\w]*)\s*=\s*(.+)$", line)
        if m:
            key, raw = m.group(1), m.group(2)
            if raw.strip()[0] in "[{":
                raw, i = _collect(lines, i, raw)
            values[key] = _parse_value(raw)
        i += 1
    return values


def parse_variable_defaults(path: Path) -> tuple[dict, set]:
    """Return ({name: default}, {all declared names}) from variables.tf."""
    defaults, declared = {}, set()
    lines = path.read_text().splitlines()
    i, current, depth = 0, None, 0
    while i < len(lines):
        line = _strip_comment(lines[i])
        if current is None:
            m = re.match(r'^\s*variable\s+"([^"]+)"\s*\{', line)
            if m:
                current, depth = m.group(1), 1
                declared.add(current)
        else:
            m = re.match(r"^\s*default\s*=\s*(.+)$", line)
            if m and depth == 1:
                raw = m.group(1)
                if raw.strip()[0] in "[{":
                    raw, i = _collect(lines, i, raw)
                    line = ""
                defaults[current] = _parse_value(raw)
            depth += line.count("{") - line.count("}")
            if depth <= 0:
                current = None
        i += 1
    return defaults, declared


def effective(tfvars_path: Path, variables_path: Path) -> dict:
    defaults, declared = parse_variable_defaults(variables_path)
    values = parse_tfvars(tfvars_path)
    unknown = set(values) - declared
    if unknown:
        raise SystemExit(f"{tfvars_path}: undeclared variables {sorted(unknown)}")
    result = {name: defaults.get(name, "<required, unset>") for name in declared}
    result.update(values)
    return result


# ---------------------------------------------------------------------------------------------
# check
# ---------------------------------------------------------------------------------------------


def cmd_check(args) -> int:
    prod = effective(Path(args.prod), Path(args.variables))
    staging = effective(Path(args.staging), Path(args.variables))
    errors = []
    for key in sorted(set(prod) | set(staging)):
        if key in ALLOWED_DEVIATIONS:
            continue
        if prod.get(key) != staging.get(key):
            errors.append(
                f"{key}: prod={prod.get(key)!r} staging={staging.get(key)!r} "
                f"(not an allowed deviation — copy the prod value into the staging tfvars)"
            )
    errors += _staging_rules(staging)
    if errors:
        print("Staging parity check FAILED:", file=sys.stderr)
        for e in errors:
            print(f"  - {e}", file=sys.stderr)
        print("Allowed deviations (docs/staging-env.md §2.2): " + ", ".join(sorted(ALLOWED_DEVIATIONS)), file=sys.stderr)
        return 1
    compared = len(set(prod) - set(ALLOWED_DEVIATIONS))
    print(f"Staging parity check passed ({compared} variables compared with prod).")
    return 0


def cmd_effective(args) -> int:
    env_dir = INFRA / "environments" / args.env
    print(json.dumps(effective(env_dir / "terraform.tfvars", Path(args.variables)), indent=2, sort_keys=True))
    return 0


# ---------------------------------------------------------------------------------------------
# live
# ---------------------------------------------------------------------------------------------


def _main_tf_constant(pattern: str, what: str) -> str:
    text = (INFRA / "main.tf").read_text()
    m = re.search(pattern, text, re.S)
    if not m:
        raise SystemExit(f"live parity: could not find {what} in main.tf (pattern {pattern!r}) — update parity.py")
    return m.group(1)


def _az(*argv):
    out = subprocess.run(["az", *argv, "-o", "json"], check=True, capture_output=True, text=True).stdout
    return json.loads(out) if out.strip() else None


def cmd_live(args) -> int:
    staging = effective(Path(args.staging), Path(args.variables))
    sub, rg = args.prod_subscription, args.prod_rg

    expected = {
        "sql.sku": _main_tf_constant(r'resource "azurerm_mssql_database" "app".*?sku_name\s*=\s*"([^"]+)"', "SQL sku_name"),
        "sql.backup_redundancy": staging["sql_backup_storage_redundancy"],
        "app.cpu": float(_main_tf_constant(r'container\s*\{\s*name\s*=\s*"backend".*?cpu\s*=\s*([\d.]+)', "container cpu")),
        "app.memory": _main_tf_constant(r'container\s*\{\s*name\s*=\s*"backend".*?memory\s*=\s*"([^"]+)"', "container memory"),
        "app.min_replicas": staging["backend_min_replicas"],
        "app.max_replicas": staging["backend_max_replicas"],
        "app.http_concurrent_requests": int(_main_tf_constant(r'http_scale_rule\s*\{.*?concurrent_requests\s*=\s*"(\d+)"', "concurrent_requests")),
        "app.wake_schedule": (
            {
                "timezone": staging["backend_wake_schedule_timezone"],
                "start": staging["backend_wake_schedule_start"],
                "end": staging["backend_wake_schedule_end"],
                "desiredReplicas": str(staging["backend_wake_schedule_replicas"]),
            }
            if staging["backend_wake_schedule_enabled"]
            else None
        ),
        "logs.retention_days": int(_main_tf_constant(r'resource "azurerm_log_analytics_workspace" "main".*?retention_in_days\s*=\s*(\d+)', "LA retention")),
        "logs.daily_quota_gb": float(staging["log_analytics_daily_quota_gb"]),
    }

    servers = _az("sql", "server", "list", "-g", rg, "--subscription", sub)
    if len(servers) != 1:
        raise SystemExit(f"live parity: expected exactly one SQL server in {rg}, found {len(servers)}")
    db = _az("sql", "db", "show", "-g", rg, "-s", servers[0]["name"], "-n", "femme_app_db", "--subscription", sub)
    app = _az("containerapp", "show", "-g", rg, "-n", "femme-backend", "--subscription", sub)
    workspaces = _az("monitor", "log-analytics", "workspace", "list", "-g", rg, "--subscription", sub)
    if len(workspaces) != 1:
        raise SystemExit(f"live parity: expected exactly one Log Analytics workspace in {rg}, found {len(workspaces)}")
    ws = workspaces[0]

    template = app["properties"]["template"]
    container = next(c for c in template["containers"] if c["name"] == "backend")
    scale = template.get("scale") or {}
    rules = scale.get("rules") or []
    http_rule = next((r for r in rules if r.get("http")), None)
    cron_rule = next((r for r in rules if (r.get("custom") or {}).get("type") == "cron"), None)

    live = {
        "sql.sku": db.get("currentServiceObjectiveName"),
        "sql.backup_redundancy": db.get("currentBackupStorageRedundancy") or db.get("requestedBackupStorageRedundancy"),
        "app.cpu": float(container["resources"]["cpu"]),
        "app.memory": container["resources"]["memory"],
        "app.min_replicas": scale.get("minReplicas") or 0,  # Azure returns null for 0
        "app.max_replicas": scale.get("maxReplicas"),
        "app.http_concurrent_requests": int(http_rule["http"]["metadata"]["concurrentRequests"]) if http_rule else None,
        "app.wake_schedule": (
            {k: cron_rule["custom"]["metadata"].get(k) for k in ("timezone", "start", "end", "desiredReplicas")}
            if cron_rule
            else None
        ),
        "logs.retention_days": ws.get("retentionInDays"),
        "logs.daily_quota_gb": float((ws.get("workspaceCapping") or {}).get("dailyQuotaGb", -1)),
    }

    errors = [f"{k}: live prod={live[k]!r} staging will create={expected[k]!r}" for k in expected if live[k] != expected[k]]
    if errors:
        print("Live prod drift check FAILED (prod was changed outside Terraform, or staging tfvars drifted):", file=sys.stderr)
        for e in errors:
            print(f"  - {e}", file=sys.stderr)
        print("Fix prod (or bring main.tf/tfvars in line with it) before trusting staging numbers.", file=sys.stderr)
        return 1
    print(f"Live prod drift check passed ({len(expected)} settings compared).")
    return 0


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--variables", default=str(INFRA / "variables.tf"))
    p.add_argument("--prod", default=str(INFRA / "environments/prod/terraform.tfvars"))
    p.add_argument("--staging", default=str(INFRA / "environments/staging/terraform.tfvars"))
    sub = p.add_subparsers(dest="cmd")
    sub.add_parser("check")
    e = sub.add_parser("effective")
    e.add_argument("env", choices=["dev", "prod", "staging"])
    lv = sub.add_parser("live")
    lv.add_argument("--prod-subscription", default="9e394b80-19d1-4187-8382-31d052ffd540")
    lv.add_argument("--prod-rg", default="femme-prod-rg")
    args = p.parse_args()
    return {"check": cmd_check, "effective": cmd_effective, "live": cmd_live, None: cmd_check}[args.cmd](args)


if __name__ == "__main__":
    sys.exit(main())
