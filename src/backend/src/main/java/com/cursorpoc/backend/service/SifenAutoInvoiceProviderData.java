package com.cursorpoc.backend.service;

/**
 * SIFEN HU-14: datos del proveedor no inscripto/extranjero de una autofactura electrónica ({@code
 * gCamAE}) — el emisor de este dominio compra un servicio a alguien que no puede emitir su propio
 * comprobante, así que la peluquería (ya registrada) se autofactura documentando esa compra.
 *
 * <p><b>Decisión de diseño (receptor de la autofactura):</b> a diferencia de una factura normal, el
 * receptor real (D3/{@code gDatRec}) de una autofactura es <b>el propio emisor</b> — se autofactura
 * a sí mismo, no hay un tercer "cliente" — este grupo separado ({@code gCamAE}) es quien describe
 * al vendedor/proveedor real. Esto no requiere ningún cambio en {@code
 * SifenDocumentXmlService.buildReceiver}: el llamador simplemente arma un {@link SifenReceiverData}
 * con el RUC/nombre del propio emisor.
 *
 * <p>Alcance deliberadamente mínimo (historia de homologación, no una funcionalidad expuesta a
 * usuarios): {@code dDirProv}/{@code cDepProv}/{@code cCiuProv} ("lugar donde se realizó la
 * operación", obligatorios en el XSD real) reusan la misma dirección/departamento/ciudad del
 * proveedor — este dominio no modela un "lugar de la operación" distinto del domicilio del
 * proveedor.
 *
 * @param natureCode naturaleza del vendedor ({@code iNatVen}): 1=No contribuyente, 2=Extranjero.
 * @param idTypeCode tipo de documento de identidad del vendedor ({@code iTipIDVen}, 1-4): 1=Cédula
 *     paraguaya, 2=Pasaporte, 3=Cédula extranjera, 4=Carnet de residencia.
 */
public record SifenAutoInvoiceProviderData(
    int natureCode,
    int idTypeCode,
    String idNumber,
    String name,
    String address,
    String houseNumber,
    String departmentCode,
    String departmentName,
    String cityCode,
    String cityName) {}
