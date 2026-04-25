"""Tests for patch-container-app-http-probes.py.

Run: python3 -m unittest scripts/azure/patch-container-app-http-probes_test.py
"""
from __future__ import annotations

import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path

_SCRIPT = Path(__file__).resolve().parent / "patch-container-app-http-probes.py"
_spec = importlib.util.spec_from_file_location("patch_probes", _SCRIPT)
if _spec is None or _spec.loader is None:  # pragma: no cover
  raise RuntimeError("could not load patch script")
m = importlib.util.module_from_spec(_spec)
sys.modules["patch_probes"] = m
_spec.loader.exec_module(m)


# Minimal structure matching az containerapp show -o yaml
SAMPLE = """
id: /subscriptions/s/resourceGroups/g/providers/Microsoft.App/containerApps/app
name: x
type: Microsoft.App/containerApps
location: eastus2
tags: {}
properties:
  provisioningState: Succeeded
  configuration:
    ingress:
      external: true
      targetPort: 8080
      fqdn: app.azurecontainerapps.io
      traffic: []
  template:
    containers:
    - name: metadata-check
      image: mcr.io/check
    - name: backend
      image: ghcr.io/x:y
"""


class PatchProbesTest(unittest.TestCase):
  def test_ingress_port_and_probes(self) -> None:
    with tempfile.TemporaryDirectory() as td:
      p = Path(td) / "app.yaml"
      p.write_text(SAMPLE, encoding="utf-8")
      r = m.patch_file(p, "backend", strip_for_update=True)
      self.assertEqual(r, 0)
      d = m.yaml.safe_load(p.read_text())
      self.assertNotIn("id", d)
      c = d["properties"]["template"]["containers"]
      backend = [x for x in c if x["name"] == "backend"][0]
      self.assertIn("probes", backend)
      self.assertEqual(len(backend["probes"]), 3)
      startup = backend["probes"][0]
      self.assertEqual(startup["type"], "Startup")
      self.assertEqual(startup["httpGet"]["port"], 8080)
      self.assertEqual(startup["httpGet"]["path"], "/health")
      self.assertEqual(startup["initialDelaySeconds"], 10)
      # Sidecar left untouched
      self.assertNotIn("probes", [x for x in c if x["name"] == "metadata-check"][0])


if __name__ == "__main__":
  unittest.main()
