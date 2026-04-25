#!/usr/bin/env python3
"""Patch an Azure Container App YAML export to use HTTP health probes for Spring Boot.

The default Azure Container Apps startup probe is TCP to the ingress port with a
short period. Spring Boot on small SKUs (Flyway + SQL) often needs more time; TCP
"connection refused" is normal while the JVM starts but can exhaust the default
window. HTTP probes to GET /health match SecurityConfig and give longer delays.

Input: a YAML file from `az containerapp show -n APP -g RG -o yaml` (or path).
The file is updated in place for use with: az containerapp update --yaml <file>
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

try:
  import yaml
except ImportError as e:
  print("error: install PyYAML (pip install pyyaml)", file=sys.stderr)
  raise SystemExit(1) from e


# Tunable: total startup budget ~ 10s + 60*5s = 310s (Azure allows large thresholds).
STARTUP = {
  "type": "Startup",
  "httpGet": {"path": "/health", "port": None},
  "initialDelaySeconds": 10,
  "periodSeconds": 5,
  "timeoutSeconds": 5,
  "failureThreshold": 60,
}
LIVENESS = {
  "type": "Liveness",
  "httpGet": {"path": "/health", "port": None},
  "initialDelaySeconds": 0,
  "periodSeconds": 30,
  "timeoutSeconds": 5,
  "failureThreshold": 3,
}
READINESS = {
  "type": "Readiness",
  "httpGet": {"path": "/health", "port": None},
  "initialDelaySeconds": 0,
  "periodSeconds": 10,
  "timeoutSeconds": 5,
  "failureThreshold": 3,
  "successThreshold": 1,
}


def _ingress_target_port(data: object) -> int:
  if not isinstance(data, dict):
    return 8080
  prop = data.get("properties", {})
  if not isinstance(prop, dict):
    return 8080
  cfg = prop.get("configuration", {})
  if not isinstance(cfg, dict):
    return 8080
  ing = cfg.get("ingress", {})
  if not isinstance(ing, dict):
    return 8080
  p = ing.get("targetPort")
  if isinstance(p, int) and 1 <= p <= 65535:
    return p
  return 8080


def _copy_probe(template: dict, port: int) -> dict:
  p = {k: v for k, v in template.items() if v is not None}
  p["httpGet"] = {**p["httpGet"], "port": port}
  return p


def _drop_keys(d: dict, keys: set[str]) -> None:
  for k in list(d.keys()):
    if k in keys:
      d.pop(k, None)


def _strip_readonly_azure_app(data: dict) -> None:
  """Remove read-only and computed fields that az containerapp update rejects on YAML apply."""
  _drop_keys(
    data,
    {
      "id",
      "name",
      "type",
      "location",
      "systemData",
      "tags",
      "identity",
      "runningStatus",
    },
  )
  p = data.get("properties")
  if not isinstance(p, dict):
    return
  _drop_keys(
    p,
    {
      "provisioningState",
      "latestRevisionName",
      "latestReadyRevisionName",
      "runningStatus",
      "outboundIpAddresses",
      "customDomainVerificationId",
      "workloadProfileName",
    },
  )
  c = p.get("configuration")
  if isinstance(c, dict) and isinstance(c.get("ingress"), dict):
    ing = c["ingress"]
    _drop_keys(ing, {"fqdn", "ip"})
    if ing.get("customDomains"):
      ing.pop("customDomains", None)
    if ing.get("traffic"):
      ing.pop("traffic", None)
  t = p.get("template")
  if isinstance(t, dict) and t.get("revisionSuffix"):
    t.pop("revisionSuffix", None)


def patch_file(path: Path, container_name: str, *, strip_for_update: bool) -> int:
  text = path.read_text(encoding="utf-8")
  data = yaml.safe_load(text)
  if not isinstance(data, dict):
    print("error: expected YAML object at root", file=sys.stderr)
    return 1

  port = _ingress_target_port(data)
  prop = data.setdefault("properties", {})
  if not isinstance(prop, dict):
    print("error: expected properties to be a map", file=sys.stderr)
    return 1
  tmpl = prop.get("template", {})
  if not isinstance(tmpl, dict):
    print("error: expected properties.template to be a map", file=sys.stderr)
    return 1
  containers = tmpl.get("containers")
  if not isinstance(containers, list) or not containers:
    print("error: no containers in template", file=sys.stderr)
    return 1

  found = None
  for c in containers:
    if not isinstance(c, dict):
      continue
    if c.get("name") == container_name:
      found = c
      break
  if found is None:
    for c in containers:
      if not isinstance(c, dict):
        continue
      n = c.get("name", "")
      if n and "metadata" not in n.lower() and n != "metadata-check":
        found = c
        break
  if found is None:
    found = next((c for c in containers if isinstance(c, dict)), None)
  if found is None:
    print("error: no suitable container to patch", file=sys.stderr)
    return 1

  probes = [
    _copy_probe(STARTUP, port),
    _copy_probe(LIVENESS, port),
    _copy_probe(READINESS, port),
  ]
  found["probes"] = probes
  if strip_for_update:
    _strip_readonly_azure_app(data)
  # Kubernetes-style list indentation for az cli compatibility
  out = yaml.dump(
    data,
    default_flow_style=False,
    allow_unicode=True,
    sort_keys=False,
    width=120,
  )
  path.write_text(out, encoding="utf-8")
  print("patched probes on container %r (http port %s → /health)" % (found.get("name"), port))
  return 0


def main() -> int:
  p = argparse.ArgumentParser(description=__doc__)
  p.add_argument("yaml_path", type=Path, help="Path to container app YAML from az show -o yaml")
  p.add_argument(
    "--container",
    default="backend",
    help="Container name to set probes on (default: backend)",
  )
  p.add_argument(
    "--strip-for-update",
    action="store_true",
    help="Remove read-only Azure fields (use before az containerapp update --yaml)",
  )
  args = p.parse_args()
  if not args.yaml_path.is_file():
    print("error: not a file: %s" % args.yaml_path, file=sys.stderr)
    return 1
  return patch_file(
    args.yaml_path,
    args.container,
    strip_for_update=args.strip_for_update,
  )


if __name__ == "__main__":
  raise SystemExit(main())
