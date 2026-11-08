# Datos de demostración (ficticios)

Cuatro archivos `.xlsx` para cargar un tenant **Demo** desde cero con la importación de Excel del panel de
plataforma. Todos los datos son inventados (nombres, teléfonos `555`, correos `@example.com`, RUC y CI sin
relación con personas reales). Las cabeceras son exactamente las de las plantillas oficiales, así que pasan la
validación de columnas.

| Archivo | Entidad | Filas | Contenido |
| --- | --- | --- | --- |
| `servicios.xlsx` | Servicios | 33 | 6 categorías: Cabello, Uñas, Estética facial, Maquillaje, Masajes, Cursos. Precios en guaraníes (enteros), duraciones de 15 a 180 min, IVA 10 % (el curso con IVA 5 %). Un servicio inactivo («Cauterización») para mostrar el estado. |
| `productos.xlsx` | Productos | 18 | 5 categorías: Shampoo y acondicionador, Tratamientos, Styling, Cuidado de uñas, Cuidado facial. Con SKU. Un producto inactivo. |
| `clientes.xlsx` | Clientes | 50 | 48 personas con teléfono (formato `0981 123 456`), correo en ~60 %, dirección en ~70 %, RUC en ~25 %, 2 inactivas, más 2 empresas con RUC propio para probar facturación a empresas. |
| `profesionales.xlsx` | Profesionales | 9 | Teléfono y correo únicos. Una inactiva. Sin PIN ni acceso al sistema (eso no se importa). |

## Pasos

1. **Crear el tenant.** Panel de plataforma → Tenants → nuevo (nombre «Salón Demo», plan a elección). Al
   crearlo se cargan solos los impuestos `IVA 10%`, `IVA 5%` y `Exento`, que los servicios y productos usan.
2. **Importar en este orden** (Panel de plataforma → Importación → elegir el tenant):
   1. `servicios.xlsx`
   2. `productos.xlsx`
   3. `clientes.xlsx`
   4. `profesionales.xlsx`

   Cada importación muestra un informe por fila. Si alguna fila se rechaza, el informe dice el motivo.
3. **Crear el usuario administrador del tenant** (Tenants → el tenant → Administradores) para poder entrar.
4. **Sembrar turnos, fichas y comprobantes** con `seed_demo_activity.py` (ver la sección siguiente).

## Actividad de demostración (turnos, fichas y comprobantes)

Estas cosas no se importan por Excel, pero las crea el script `seed_demo_activity.py` usando la API del backend
(solo biblioteca estándar de Python 3.9+, sin instalar nada). Corrélo **después** de importar los 4 Excel y de
crear el usuario administrador del tenant:

```bash
python3 seed_demo_activity.py \
  --base-url https://URL-DEL-BACKEND \
  --email admin@tu-demo.example.com \
  --tz America/Asuncion
# pide la contraseña por teclado; agregá --dry-run para ver qué haría sin escribir nada
```

Qué hace:

- Si faltan: carga los datos del negocio («Salón Demo»), crea un timbrado de prueba y abre la caja.
- Da horario de trabajo (lun-sáb, 08:00 a 18:00) a las profesionales que no lo tengan.
- **Historial:** unos 100 comprobantes cobrados repartidos en los últimos 28 días (efectivo, tarjeta y
  transferencia, con algunas propinas), con la fecha en que "ocurrieron".
- **Agenda:** turnos de hoy y de los próximos 7 días, sin superposición por profesional, con alrededor del 45 %
  confirmados.
- **Hoy en vivo:** cuatro turnos para mostrar cada estado: En curso, Completado sin cobrar, con ficha abierta y
  Cobrado.

Opciones útiles: `--only history|agenda|live` (se puede repetir) para correr solo una parte, `--days-ahead N`,
`--history-days N` (máximo 30), `--seed N` para variar los datos y `--yes` para no pedir confirmación.

Conviene saber:

- **Un turno no puede empezar en el pasado** (lo rechaza el backend). Por eso el pasado se muestra con
  comprobantes, y los turnos de hoy se crean desde ahora hacia adelante: corré el script **a primera hora del día
  de la demo** para que la agenda de hoy no quede casi vacía.
- Correrlo dos veces suma más datos (los turnos que chocan se saltan, los comprobantes se duplican). Para
  repetir la demo desde cero, creá un tenant nuevo.
- Los comprobantes se emiten de verdad en el tenant: dejá desactivada la facturación electrónica SIFEN en el
  tenant Demo para que no intente enviarlos.
- Los productos no se venden en los comprobantes de la siembra (para no mover stock).

## Lo que sigue siendo manual

- El **PIN y el acceso al sistema** de las profesionales.
- El **logo** del negocio.

## Reglas que cumplen los archivos (por si los editás)

- Las columnas obligatorias son `categoria`, `nombre`, `precio` y `duracion_minutos` (servicios), y
  `nombre_completo` (clientes y profesionales). El resto es opcional.
- `precio` es un entero en guaraníes, sin separadores. `duracion_minutos` es un entero de 1 o más.
- Una misma categoría no puede mezclar servicios y productos. Hay que usar nombres distintos
  (por eso «Cuidado de uñas» es de productos y «Uñas» de servicios).
- `impuesto` debe llamarse exactamente `IVA 10%`, `IVA 5%` o `Exento` (o ir vacío).
- `ruc` con formato `12345678-9`. El teléfono de las profesionales debe tener 10 dígitos.
- El correo de las profesionales no se puede repetir.
- `activo` vale `SI` o `NO` (vacío cuenta como `SI`).
- Los nombres de clientes y profesionales se guardan en mayúsculas.

## Regenerar

```bash
pip install openpyxl
python3 generate_demo_data.py
```

La semilla aleatoria es fija: generar de nuevo produce los mismos datos.
