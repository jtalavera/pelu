# Configuración — rediseño minimalista

Parte del rediseño general. Sin cambios de backend.

- **Navegación** (`SettingsLayout`): solapas segmentadas **Negocio / Timbrado / SIFEN** (según rol y la función SIFEN) y un menú **⋯** con **Impuestos**, **Auditoría** y **Dispositivos compartidos** (solo los que el rol puede ver; al elegir uno su nombre aparece como título bajo las solapas). La acción principal de cada sección (p. ej. "+ Agregar timbrado") va en el encabezado vía `SettingsHeaderAction`.
- **Negocio**: una columna con secciones plegables (Datos del negocio abierta, Contacto, Facturación electrónica si la función está activa, Logo; una sección con error se abre sola) y una barra fija inferior **Descartar / Guardar cambios**, que se habilita solo cuando hay cambios ("Hay cambios sin guardar"). Los `id` de los campos se mantienen.
- **Timbrado**: filas (`Timbrado N · estado` y `vigencia · próximo número`) con menú ⋯ (Editar, Activar/Desactivar, Eliminar si no tiene comprobantes). "+ Agregar timbrado" y "Editar" abren diálogos con todos los campos (los bloqueados por tener comprobantes siguen bloqueados).
- **Impuestos**: filas con nombre, porcentaje, interruptor de activo (al desactivar pide confirmación) y ⋯ para editar; agregar/editar en diálogo.
- **SIFEN**: tres secciones plegables (Certificado, CSC, Inutilización de numeración). La inutilización lista las filas con su estado y plazo, y "+ Inutilizar un rango manualmente" abre un diálogo. Los estilos compartidos de `sifenFormStyles` pasan a los tokens nuevos (sin fondos tintados), lo que también afecta a las pantallas de plataforma que los usan.
- **Dispositivos compartidos**: filas con etiquetas "Este dispositivo"/"Bloqueado" y ⋯ (Desbloquear, Revocar); "Activar este dispositivo" en un diálogo.
- **Auditoría** (también la de plataforma): buscador por usuario, "Filtros" plegado (desde, hasta, qué) y filas con acción, `usuario · fecha` y el número de registro.

## Tests
Vitest: `SettingsLayout`, `BusinessSettingsPage`, `FiscalStampSettingsPage`, `SifenCertificatesPage`, `AuditLogPanel` adaptados. Los specs de Playwright de configuración se adaptan en la pasada final.
