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

## Lo que no se puede importar por Excel

Estas cosas hay que cargarlas a mano en el tenant Demo (o pedir un script de siembra):

- **Datos del negocio** (nombre comercial, RUC, dirección, logo) y **timbrado fiscal** de prueba.
- **Turnos, fichas de servicio y comprobantes.** No tienen importación. Para que la agenda y el Panel principal
  no se vean vacíos en una demo conviene sembrarlos con un script que use fechas relativas a hoy.
- **Acceso y PIN de las profesionales**, y los horarios de trabajo de cada una.
- **Caja del día**: abrirla antes de la demo.

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
