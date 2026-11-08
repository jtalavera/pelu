#!/usr/bin/env python3
"""Siembra actividad ficticia en un tenant Demo para que la app no se vea vacía.

Usa solo la API pública del backend (como lo haría la web), con el usuario administrador del tenant.
Corre DESPUÉS de importar los 4 Excel (servicios, productos, clientes y profesionales): necesita que existan
servicios, clientes y profesionales.

Qué crea:
  * Datos del negocio y timbrado de prueba, y abre la caja (solo si faltan).
  * Horario de trabajo (lun-sáb) para las profesionales que no tengan.
  * Historial: comprobantes cobrados con fecha de los últimos días (la API acepta hasta 30 días atrás).
  * Agenda: turnos de hoy y de los próximos días, sin superposición por profesional, parte confirmados.
  * "En vivo" de hoy: un turno En curso, uno Completado sin cobrar, otros con ficha abierta y uno Cobrado.

Límite de la API: un turno no puede empezar en el pasado. Por eso conviene correr el script a primera hora del
día de la demo (los turnos de hoy se crean desde "ahora" hacia adelante) y el pasado se muestra con comprobantes.

Solo usa la biblioteca estándar (Python 3.9+).

Ejemplo:
  python3 seed_demo_activity.py --base-url https://mi-backend.example --email admin@demo.example --password '...'
"""
from __future__ import annotations

import argparse
import getpass
import json
import random
import sys
import urllib.error
import urllib.request
from datetime import date, datetime, time, timedelta, timezone
from typing import Any, Optional


# ── HTTP ─────────────────────────────────────────────────────────────────────
class ApiError(Exception):
    def __init__(self, status: int, body: str, method: str, path: str):
        super().__init__(f"{method} {path} -> {status}: {body[:300]}")
        self.status = status
        self.body = body


class Api:
    def __init__(self, base_url: str):
        self.base = base_url.rstrip("/")
        self.token: Optional[str] = None

    def call(self, method: str, path: str, body: Any = None) -> Any:
        data = None if body is None else json.dumps(body).encode()
        req = urllib.request.Request(self.base + path, data=data, method=method)
        req.add_header("Content-Type", "application/json")
        req.add_header("Accept", "application/json")
        if self.token:
            req.add_header("Authorization", f"Bearer {self.token}")
        try:
            with urllib.request.urlopen(req, timeout=60) as res:
                raw = res.read().decode()
                return json.loads(raw) if raw else None
        except urllib.error.HTTPError as e:
            raise ApiError(e.code, e.read().decode(errors="replace"), method, path) from None

    def get(self, path: str) -> Any:
        return self.call("GET", path)

    def post(self, path: str, body: Any = None) -> Any:
        return self.call("POST", path, {} if body is None else body)

    def put(self, path: str, body: Any) -> Any:
        return self.call("PUT", path, body)

    def patch(self, path: str, body: Any) -> Any:
        return self.call("PATCH", path, body)


# ── Ayudas ───────────────────────────────────────────────────────────────────
def iso_utc(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def money(value: Any) -> int:
    return int(round(float(value)))


def log(msg: str) -> None:
    print(msg, flush=True)


class Seeder:
    def __init__(self, api: Api, rnd: random.Random, tz, dry_run: bool):
        self.api = api
        self.rnd = rnd
        self.tz = tz
        self.dry = dry_run
        self.professionals: list[dict] = []
        self.services: list[dict] = []
        self.clients: list[dict] = []
        # turnos creados en esta corrida: profesional -> [(inicio, fin)] para no superponer
        self.busy: dict[int, list[tuple[datetime, datetime]]] = {}

    # ── Preparación ──────────────────────────────────────────────────────────
    def prepare_business(self) -> None:
        profile = self.api.get("/api/business-profile")
        if profile and profile.get("businessName"):
            log(f"Negocio: {profile['businessName']} (se deja como está)")
            return
        log("Negocio: cargando datos de «Salón Demo»")
        if self.dry:
            return
        self.api.put(
            "/api/business-profile",
            {
                "businessName": "Salón Demo",
                "ruc": "80099999-1",
                "address": "Av. Mariscal López 1234, Asunción",
                "phone": "0981 555 000",
                "contactEmail": "contacto@salon-demo.example.com",
                "logoDataUrl": None,
            },
        )

    def prepare_fiscal_stamp(self) -> None:
        today = date.today()
        stamps = self.api.get("/api/fiscal-stamps") or []
        for s in stamps:
            valid_until = s.get("validUntil")
            if (
                s.get("active")
                and s["validFrom"] <= today.isoformat()
                and (valid_until is None or valid_until >= today.isoformat())
            ):
                log(f"Timbrado: usando el activo {s['stampNumber']}")
                return
        log("Timbrado: creando uno de prueba")
        if self.dry:
            return
        created = self.api.post(
            "/api/fiscal-stamps",
            {
                "stampNumber": "12345678",
                "validFrom": today.isoformat(),
                "validUntil": (today + timedelta(days=365)).isoformat(),
                "rangeFrom": 1,
                "rangeTo": 9_999_999,
                "initialEmissionNumber": 1,
            },
        )
        self.api.post(f"/api/fiscal-stamps/{created['id']}/activate", {})

    def prepare_cash(self) -> None:
        try:
            self.api.get("/api/cash-sessions/current")
            log("Caja: ya está abierta")
            return
        except ApiError as e:
            if e.status not in (404, 204):
                raise
        log("Caja: abriendo con Gs. 200.000")
        if not self.dry:
            self.api.post("/api/cash-sessions/open", {"openingCashAmount": 200000})

    def load_catalog(self) -> None:
        self.professionals = [p for p in self.api.get("/api/professionals") if p.get("active")]
        all_services = self.api.get("/api/services") or []
        self.services = [s for s in all_services if s.get("active") and s.get("kind", "SERVICE") == "SERVICE"]
        self.clients = [c for c in (self.api.get("/api/clients?active=true") or []) if c.get("active", True)]
        log(
            f"Catálogo: {len(self.professionals)} profesionales, {len(self.services)} servicios, "
            f"{len(self.clients)} clientes"
        )
        if not (self.professionals and self.services and self.clients):
            sys.exit("Faltan profesionales, servicios o clientes: importá primero los 4 Excel.")

    def ensure_schedules(self) -> None:
        for p in self.professionals:
            if p.get("schedules"):
                continue
            log(f"Horario: {p['fullName']} lun-sáb 08:00-18:00")
            if self.dry:
                continue
            self.api.put(
                f"/api/professionals/{p['id']}/schedules",
                [{"dayOfWeek": d, "startTime": "08:00", "endTime": "18:00"} for d in range(1, 7)],
            )

    # ── Piezas ───────────────────────────────────────────────────────────────
    def pick_service(self) -> dict:
        # los servicios baratos y de duración corta se piden más
        weights = [1.0 / (1 + money(s["priceMinor"]) / 100_000) for s in self.services]
        return self.rnd.choices(self.services, weights=weights, k=1)[0]

    def local(self, d: date, hh: int, mm: int) -> datetime:
        return datetime.combine(d, time(hh, mm), tzinfo=self.tz)

    def invoice_body(self, client: Optional[dict], lines: list[dict], issued_at: Optional[datetime],
                     record_id: Optional[int] = None) -> dict:
        total = sum(l["quantity"] * l["unitPrice"] for l in lines)
        tips = 0
        if self.rnd.random() < 0.2:
            tips = self.rnd.choice([5000, 10000, 20000])
        method = self.rnd.choices(
            ["CASH", "DEBIT_CARD", "CREDIT_CARD", "TRANSFER"], weights=[45, 20, 20, 15], k=1
        )[0]
        payment: dict[str, Any] = {"method": method, "amount": total + tips}
        if method in ("DEBIT_CARD", "CREDIT_CARD"):
            payment["cardBrand"] = self.rnd.choice(["VISA", "MASTERCARD", "PANAL"])
        return {
            "clientId": client["id"] if client else None,
            "clientDisplayName": None if client else "Cliente ocasional",
            "clientRucOverride": None,
            "discountType": None,
            "discountValue": None,
            "lines": lines,
            "payments": [payment],
            "serviceRecordId": record_id,
            "tipsAmount": tips,
            "issuedAt": iso_utc(issued_at) if issued_at else None,
        }

    def make_lines(self, professional: dict, services: list[dict]) -> list[dict]:
        return [
            {
                "serviceId": s["id"],
                "description": s["name"],
                "quantity": 1,
                "unitPrice": money(s["priceMinor"]),
                "discountType": None,
                "discountValue": None,
                "professionalId": professional["id"],
            }
            for s in services
        ]

    # ── 1. Historial de comprobantes ─────────────────────────────────────────
    def seed_history(self, days: int) -> int:
        today = date.today()
        created = 0
        # del más viejo al más nuevo, para que la numeración siga el orden de las fechas
        for back in range(days, 0, -1):
            d = today - timedelta(days=back)
            if d.weekday() == 6:  # domingo: cerrado
                continue
            count = self.rnd.randint(2, 6)
            slots = sorted(self.rnd.sample(range(9 * 60, 19 * 60, 15), count))
            for minute in slots:
                issued = self.local(d, minute // 60, minute % 60)
                client = self.rnd.choice(self.clients) if self.rnd.random() < 0.85 else None
                professional = self.rnd.choice(self.professionals)
                n_services = self.rnd.choices([1, 2, 3], weights=[60, 30, 10], k=1)[0]
                services = [self.pick_service() for _ in range(n_services)]
                body = self.invoice_body(client, self.make_lines(professional, services), issued)
                if self.dry:
                    created += 1
                    continue
                try:
                    self.api.post("/api/invoices", body)
                    created += 1
                except ApiError as e:
                    log(f"  comprobante {d} omitido: {e}")
        log(f"Historial: {created} comprobantes de los últimos {days} días")
        return created

    # ── 2. Agenda de los próximos días ───────────────────────────────────────
    def is_free(self, professional_id: int, start: datetime, end: datetime) -> bool:
        return all(end <= s or start >= e for s, e in self.busy.get(professional_id, []))

    def create_turno(self, professional: dict, service: dict, client: Optional[dict], start: datetime) -> Optional[int]:
        end = start + timedelta(minutes=int(service["durationMinutes"]))
        if not self.is_free(professional["id"], start, end):
            return None
        if self.dry:
            self.busy.setdefault(professional["id"], []).append((start, end))
            return -1
        try:
            res = self.api.post(
                "/api/appointments",
                {
                    "clientId": client["id"] if client else None,
                    "professionalId": professional["id"],
                    "serviceId": service["id"],
                    "startAt": iso_utc(start),
                },
            )
        except ApiError as e:
            if e.status == 409:  # ya hay un turno ahí (corrida anterior)
                self.busy.setdefault(professional["id"], []).append((start, end))
                return None
            raise
        self.busy.setdefault(professional["id"], []).append((start, end))
        return int(res["id"])

    def seed_agenda(self, days: int) -> int:
        now = datetime.now(self.tz)
        today = now.date()
        created = confirmed = 0
        for ahead in range(0, days):
            d = today + timedelta(days=ahead)
            if d.weekday() == 6:
                continue
            for professional in self.professionals:
                n = self.rnd.randint(2, 6) if d.weekday() < 5 else self.rnd.randint(1, 4)
                for _ in range(n):
                    minute = self.rnd.randrange(9 * 60, 17 * 60 + 30, 15)
                    start = self.local(d, minute // 60, minute % 60)
                    if start < now + timedelta(minutes=90):  # la API rechaza el pasado; dejo margen
                        continue
                    service = self.pick_service()
                    client = self.rnd.choice(self.clients) if self.rnd.random() < 0.9 else None
                    turno_id = self.create_turno(professional, service, client, start)
                    if turno_id is None:
                        continue
                    created += 1
                    if not self.dry and self.rnd.random() < 0.45:
                        try:
                            self.api.patch(f"/api/appointments/{turno_id}/status", {"status": "CONFIRMED", "cancelReason": None})
                            confirmed += 1
                        except ApiError as e:
                            log(f"  turno {turno_id} no se pudo confirmar: {e}")
        log(f"Agenda: {created} turnos creados ({confirmed} confirmados)")
        return created

    # ── 3. Turnos «en vivo» de hoy ───────────────────────────────────────────
    def seed_live_today(self) -> None:
        now = datetime.now(self.tz)
        pros = self.professionals[:]
        self.rnd.shuffle(pros)
        scenarios = ["IN_PROGRESS", "COMPLETED_UNPAID", "OPEN_RECORD", "CHARGED"]
        log("Hoy en vivo: turnos para mostrar cada estado")
        for i, scenario in enumerate(scenarios):
            professional = pros[i % len(pros)]
            service = self.pick_service()
            client = self.rnd.choice(self.clients)
            start = (now + timedelta(minutes=10 + 15 * i)).replace(second=0, microsecond=0)
            start = start.replace(minute=(start.minute // 5) * 5)
            turno_id = self.create_turno(professional, service, client, start)
            if turno_id is None or self.dry:
                continue
            line = self.make_lines(professional, [service])
            try:
                if scenario == "IN_PROGRESS":
                    self.api.patch(f"/api/appointments/{turno_id}/status", {"status": "IN_PROGRESS", "cancelReason": None})
                elif scenario == "COMPLETED_UNPAID":
                    self.api.patch(f"/api/appointments/{turno_id}/status", {"status": "COMPLETED", "cancelReason": None})
                else:
                    record = self.api.post(
                        "/api/service-records",
                        {
                            "clientId": client["id"],
                            "lines": [
                                {
                                    "serviceId": service["id"],
                                    "professionalId": professional["id"],
                                    "quantity": 1,
                                    "unitPrice": money(service["priceMinor"]),
                                }
                            ],
                            "tips": [],
                        },
                    )
                    self.api.post(f"/api/appointments/{turno_id}/service-record/assign", {"serviceRecordId": record["id"]})
                    if scenario == "CHARGED":
                        self.api.post("/api/invoices", self.invoice_body(client, line, None, record["id"]))
            except ApiError as e:
                log(f"  escenario {scenario} falló: {e}")


# ── main ─────────────────────────────────────────────────────────────────────
def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--base-url", default="http://localhost:8080", help="URL del backend (sin /api)")
    ap.add_argument("--email", required=True, help="correo del administrador del tenant Demo")
    ap.add_argument("--password", help="contraseña (si falta, se pide por teclado)")
    ap.add_argument("--history-days", type=int, default=28, help="días de comprobantes hacia atrás (máx. 30)")
    ap.add_argument("--days-ahead", type=int, default=7, help="días de agenda hacia adelante, contando hoy")
    ap.add_argument("--only", choices=["history", "agenda", "live"], action="append",
                    help="correr solo esa parte (se puede repetir); por defecto, todo")
    ap.add_argument("--tz", help="zona horaria IANA (por defecto, la del sistema), p. ej. America/Asuncion")
    ap.add_argument("--seed", type=int, default=2026, help="semilla aleatoria (mismos datos cada vez)")
    ap.add_argument("--dry-run", action="store_true", help="no escribe nada: solo cuenta lo que haría")
    ap.add_argument("--yes", action="store_true", help="no pedir confirmación")
    args = ap.parse_args()

    if args.history_days > 30:
        sys.exit("--history-days: la API acepta comprobantes de hasta 30 días atrás.")

    tz = datetime.now().astimezone().tzinfo
    if args.tz:
        from zoneinfo import ZoneInfo

        tz = ZoneInfo(args.tz)

    api = Api(args.base_url)
    password = args.password or getpass.getpass("Contraseña: ")
    res = api.post("/api/auth/login", {"email": args.email, "password": password})
    api.token = res["accessToken"]

    profile = api.get("/api/business-profile") or {}
    log(f"Backend: {args.base_url}")
    log(f"Tenant:  {profile.get('businessName') or '(sin nombre todavía)'}  — usuario {args.email}")
    if not args.yes and not args.dry_run:
        if input("Esto crea turnos, fichas y comprobantes en ese tenant. ¿Seguir? [s/N] ").strip().lower() not in ("s", "si", "sí", "y"):
            sys.exit("Cancelado.")

    parts = set(args.only or ["history", "agenda", "live"])
    seeder = Seeder(api, random.Random(args.seed), tz, args.dry_run)
    seeder.prepare_business()
    seeder.prepare_fiscal_stamp()
    seeder.prepare_cash()
    seeder.load_catalog()
    seeder.ensure_schedules()
    if "history" in parts:
        seeder.seed_history(args.history_days)
    if "agenda" in parts:
        seeder.seed_agenda(args.days_ahead)
    if "live" in parts:
        seeder.seed_live_today()
    log("Listo." + (" (simulacro: no se escribió nada)" if args.dry_run else ""))


if __name__ == "__main__":
    main()
