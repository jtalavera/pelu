#!/usr/bin/env python3
"""Genera los 4 archivos .xlsx de importación con datos ficticios para un tenant Demo.

Cabeceras = las plantillas oficiales (ImportColumnTemplateRegistry): servicios, productos,
clientes y profesionales. Todos los datos son inventados.

Uso:  python3 generate_demo_data.py   (necesita: pip install openpyxl)
"""
import random
from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Font

OUT = Path(__file__).parent
random.seed(2026)  # mismos datos cada vez


def write(name, sheet, headers, rows):
    wb = Workbook()
    ws = wb.active
    ws.title = sheet
    ws.append(headers)
    for c in ws[1]:
        c.font = Font(bold=True)
    for r in rows:
        ws.append(r)
    for i, h in enumerate(headers, start=1):
        width = max(len(str(h)), *(len(str(r[i - 1])) for r in rows)) + 2
        ws.column_dimensions[ws.cell(row=1, column=i).column_letter].width = min(width, 46)
    # teléfonos / documentos / RUC como texto para que Excel no los convierta en números
    for row in ws.iter_rows(min_row=2):
        for cell in row:
            if isinstance(cell.value, str):
                cell.number_format = "@"
    wb.save(OUT / name)
    print(f"{name}: {len(rows)} filas")


# ── Servicios ────────────────────────────────────────────────────────────────
# categoria, nombre, precio (Gs, entero), duracion_minutos, impuesto, activo
SERVICES = [
    ("Cabello", "Corte de dama", 90000, 45, "IVA 10%", "SI"),
    ("Cabello", "Corte de caballero", 60000, 30, "IVA 10%", "SI"),
    ("Cabello", "Corte infantil", 50000, 30, "IVA 10%", "SI"),
    ("Cabello", "Lavado y peinado", 70000, 45, "IVA 10%", "SI"),
    ("Cabello", "Brushing", 80000, 45, "IVA 10%", "SI"),
    ("Cabello", "Peinado para fiesta", 180000, 60, "IVA 10%", "SI"),
    ("Cabello", "Color raíz", 220000, 90, "IVA 10%", "SI"),
    ("Cabello", "Color completo", 350000, 120, "IVA 10%", "SI"),
    ("Cabello", "Mechas", 450000, 150, "IVA 10%", "SI"),
    ("Cabello", "Balayage", 650000, 180, "IVA 10%", "SI"),
    ("Cabello", "Tratamiento de keratina", 500000, 150, "IVA 10%", "SI"),
    ("Cabello", "Botox capilar", 420000, 120, "IVA 10%", "SI"),
    ("Cabello", "Hidratación profunda", 150000, 60, "IVA 10%", "SI"),
    ("Cabello", "Cauterización", 380000, 120, "IVA 10%", "NO"),
    ("Uñas", "Manicura simple", 50000, 40, "IVA 10%", "SI"),
    ("Uñas", "Manicura semipermanente", 90000, 60, "IVA 10%", "SI"),
    ("Uñas", "Esmaltado en gel", 110000, 60, "IVA 10%", "SI"),
    ("Uñas", "Uñas acrílicas", 220000, 120, "IVA 10%", "SI"),
    ("Uñas", "Retiro de esmalte semipermanente", 30000, 20, "IVA 10%", "SI"),
    ("Uñas", "Pedicura", 80000, 60, "IVA 10%", "SI"),
    ("Uñas", "Spa de pies", 130000, 75, "IVA 10%", "SI"),
    ("Estética facial", "Limpieza facial profunda", 200000, 75, "IVA 10%", "SI"),
    ("Estética facial", "Perfilado de cejas", 40000, 20, "IVA 10%", "SI"),
    ("Estética facial", "Diseño y tintura de cejas", 70000, 30, "IVA 10%", "SI"),
    ("Estética facial", "Lifting de pestañas", 190000, 75, "IVA 10%", "SI"),
    ("Estética facial", "Depilación de bozo", 25000, 15, "IVA 10%", "SI"),
    ("Maquillaje", "Maquillaje social", 150000, 60, "IVA 10%", "SI"),
    ("Maquillaje", "Maquillaje de novia", 450000, 120, "IVA 10%", "SI"),
    ("Maquillaje", "Peinado y maquillaje", 300000, 120, "IVA 10%", "SI"),
    ("Masajes", "Masaje relajante (60 min)", 170000, 60, "IVA 10%", "SI"),
    ("Masajes", "Masaje descontracturante", 190000, 60, "IVA 10%", "SI"),
    ("Masajes", "Drenaje linfático", 210000, 75, "IVA 10%", "SI"),
    ("Cursos", "Taller de automaquillaje", 250000, 120, "IVA 5%", "SI"),
]

# ── Productos ────────────────────────────────────────────────────────────────
# categoria, nombre, precio, impuesto, activo, sku
PRODUCTS = [
    ("Shampoo y acondicionador", "Shampoo reparador 300 ml", 85000, "IVA 10%", "SI", "SH-REP-300"),
    ("Shampoo y acondicionador", "Acondicionador reparador 300 ml", 85000, "IVA 10%", "SI", "AC-REP-300"),
    ("Shampoo y acondicionador", "Shampoo matizador violeta 300 ml", 95000, "IVA 10%", "SI", "SH-MAT-300"),
    ("Shampoo y acondicionador", "Shampoo anticaspa 250 ml", 70000, "IVA 10%", "SI", "SH-ANT-250"),
    ("Tratamientos", "Mascarilla nutritiva 250 g", 120000, "IVA 10%", "SI", "MS-NUT-250"),
    ("Tratamientos", "Ampolla de keratina (caja x6)", 180000, "IVA 10%", "SI", "AM-KER-06"),
    ("Tratamientos", "Aceite de argán 60 ml", 110000, "IVA 10%", "SI", "AC-ARG-60"),
    ("Tratamientos", "Protector térmico 200 ml", 75000, "IVA 10%", "SI", "PT-TER-200"),
    ("Styling", "Spray fijador 300 ml", 65000, "IVA 10%", "SI", "ST-FIJ-300"),
    ("Styling", "Crema para peinar 150 ml", 60000, "IVA 10%", "SI", "ST-CRE-150"),
    ("Styling", "Cera modeladora 100 g", 55000, "IVA 10%", "SI", "ST-CER-100"),
    ("Styling", "Cepillo térmico", 90000, "IVA 10%", "SI", "ST-CEP-01"),
    ("Cuidado de uñas", "Esmalte clásico (varios colores)", 35000, "IVA 10%", "SI", "UN-ESM-01"),
    ("Cuidado de uñas", "Aceite de cutícula", 30000, "IVA 10%", "SI", "UN-ACE-01"),
    ("Cuidado de uñas", "Crema de manos 100 ml", 45000, "IVA 10%", "SI", "UN-CRE-100"),
    ("Cuidado de uñas", "Kit de limas profesionales", 40000, "IVA 10%", "NO", "UN-LIM-KIT"),
    ("Cuidado facial", "Gel limpiador facial 150 ml", 95000, "IVA 10%", "SI", "FA-GEL-150"),
    ("Cuidado facial", "Protector solar FPS 50", 130000, "IVA 10%", "SI", "FA-SOL-50"),
]

# ── Profesionales ────────────────────────────────────────────────────────────
# nombre_completo, telefono (10 dígitos), email (único), direccion, activo
PROFESSIONALS = [
    ("Abril Benítez", "0981 555 101", "abril.benitez@example.com", "Barrio Recoleta, Asunción", "SI"),
    ("Camila Ortiz", "0982 555 102", "camila.ortiz@example.com", "Barrio Villa Morra, Asunción", "SI"),
    ("Daniela Giménez", "0983 555 103", "daniela.gimenez@example.com", "Barrio Mburucuyá, Asunción", "SI"),
    ("Fernanda Rojas", "0984 555 104", "fernanda.rojas@example.com", "Barrio Las Mercedes, Asunción", "SI"),
    ("Julieta Cáceres", "0985 555 105", "julieta.caceres@example.com", "Lambaré", "SI"),
    ("Lorena Vera", "0986 555 106", "lorena.vera@example.com", "Fernando de la Mora", "SI"),
    ("Marcos Duarte", "0971 555 107", "marcos.duarte@example.com", "San Lorenzo", "SI"),
    ("Natalia Franco", "0972 555 108", "natalia.franco@example.com", "Luque", "SI"),
    ("Pablo Segovia", "0973 555 109", "pablo.segovia@example.com", "Barrio Sajonia, Asunción", "NO"),
]

# ── Clientes ─────────────────────────────────────────────────────────────────
FIRST_F = ["María", "Ana", "Lucía", "Sofía", "Valentina", "Carolina", "Patricia", "Gabriela", "Rosa",
           "Laura", "Mónica", "Silvia", "Andrea", "Claudia", "Verónica", "Jazmín", "Paola", "Noelia",
           "Karina", "Liliana", "Romina", "Tamara", "Belén", "Cecilia", "Diana"]
FIRST_M = ["Carlos", "Diego", "Javier", "Luis", "Martín", "Rodrigo", "Sebastián", "Andrés"]
LAST = ["González", "Benítez", "Martínez", "López", "Gómez", "Fernández", "Rodríguez", "Villalba",
        "Ramírez", "Báez", "Acosta", "Aquino", "Cabrera", "Duarte", "Ferreira", "Insfrán", "Lezcano",
        "Medina", "Núñez", "Ojeda", "Paredes", "Quintana", "Romero", "Sosa", "Torres", "Vargas",
        "Zárate", "Ayala", "Britez", "Centurión"]
STREETS = ["Av. Mariscal López", "Calle Palma", "Av. España", "Av. Brasilia", "Calle Brasil",
           "Av. Santa Teresa", "Calle Hernandarias", "Av. San Martín", "Calle Estados Unidos"]
BARRIOS = ["Recoleta", "Villa Morra", "Las Mercedes", "Sajonia", "Mburucuyá", "Los Laureles",
           "Carmelitas", "Tembetary"]
PREFIXES = ["0981", "0982", "0983", "0984", "0985", "0986", "0971", "0972", "0961", "0991"]


def ci():
    return f"{random.randint(1_200_000, 6_900_000)}"


clients = []
used = set()
n = 0
while len(clients) < 48:
    male = random.random() < 0.15
    first = random.choice(FIRST_M if male else FIRST_F)
    full = f"{first} {random.choice(LAST)} {random.choice(LAST)}"
    if full in used:
        continue
    used.add(full)
    n += 1
    phone = f"{random.choice(PREFIXES)} {random.randint(100, 999)} {random.randint(100, 999)}"
    slug = (first + "." + full.split()[1]).lower()
    for a, b in (("á", "a"), ("é", "e"), ("í", "i"), ("ó", "o"), ("ú", "u"), ("ñ", "n")):
        slug = slug.replace(a, b)
    email = f"{slug}{n}@example.com" if random.random() < 0.6 else ""
    document = ci()
    # ~1 de cada 4 con RUC (formato 1234567-8, ficticio)
    ruc = f"{document}-{random.randint(0, 9)}" if random.random() < 0.25 else ""
    address = f"{random.choice(STREETS)} {random.randint(100, 4999)}, {random.choice(BARRIOS)}" if random.random() < 0.7 else ""
    active = "NO" if n in (11, 37) else "SI"
    clients.append((full, phone, email, ruc, document, address, active))

# Clientes tipo empresa (facturan a RUC propio)
clients += [
    ("Estudio Contable Demo S.A.", "0214 555 301", "contacto@estudio-demo.example.com", "80012345-6", "", "Av. Mariscal López 1234, Asunción", "SI"),
    ("Agencia de Eventos Brillo S.R.L.", "0214 555 302", "eventos@brillo-demo.example.com", "80023456-7", "", "Av. España 2100, Asunción", "SI"),
]

if __name__ == "__main__":
    write("servicios.xlsx", "services", ["categoria", "nombre", "precio", "duracion_minutos", "impuesto", "activo"], SERVICES)
    write("productos.xlsx", "products", ["categoria", "nombre", "precio", "impuesto", "activo", "sku"], PRODUCTS)
    write("clientes.xlsx", "clients", ["nombre_completo", "telefono", "email", "ruc", "documento_identidad", "direccion", "activo"], clients)
    write("profesionales.xlsx", "professionals", ["nombre_completo", "telefono", "email", "direccion", "activo"], PROFESSIONALS)
