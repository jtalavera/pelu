package com.cursorpoc.backend.service;

/**
 * SIFEN HU-14: campos que componen una nota de remisión electrónica ({@code gCamNRE}, motivo de
 * traslado + {@code gTransp}, datos del transporte) — documento de movimiento de bienes, no de
 * venta, que esta peluquería nunca emite en operación real (ver {@code
 * Especificacion_SIFEN_Peluqueria.md}, HU-14) pero que la DNIT exige homologar igual.
 *
 * <p>Alcance deliberadamente mínimo: solo los campos que el schema real ({@code DE_v150.xsd},
 * {@code tgCamNRE}/{@code tgTransp}) exige sin {@code minOccurs="0"} — {@code gCamSal}/{@code
 * gCamEnt} (local de salida/entrega) y el resto de {@code gTransp} (manifiesto, vehículo,
 * transportista, etc.) son opcionales en el propio XSD y se omiten acá; si la verificación en vivo
 * revela que SIFEN los exige de todos modos por una regla de contenido (no de schema), ese hallazgo
 * se documenta en PROGRESS.md igual que los gaps de HU-13, no se adivina de antemano.
 *
 * @param reasonCode motivo del traslado ({@code iMotEmiNR}, 1-14 o 99) — ver {@code tdDMotivTras}
 *     para la lista completa (ventas, consignación, exportación, etc.).
 * @param responsibleCode responsable de la emisión ({@code iRespEmiNR}, 1-5): 1=Emisor de la
 *     factura, 2=Poseedor de la factura y bienes, 3=Empresa transportista, 4=Despachante de
 *     Aduanas, 5=Agente de transporte o intermediario.
 * @param estimatedKm kilómetros estimados de recorrido ({@code dKmR}), 1-99999.
 * @param transportModeCode modalidad del transporte ({@code iModTrans}, 1-4): 1=Terrestre,
 *     2=Fluvial, 3=Aéreo, 4=Multimodal.
 * @param freightResponsibleCode responsable del costo del flete ({@code iRespFlete}, 1-5): 1=Emisor
 *     de la factura, 2=Receptor, 3=Tercero, 4=Agente intermediario, 5=Transporte propio.
 * @param referencedControlNumber CDC de 44 caracteres de la factura de venta que motiva este
 *     traslado — gap encontrado en vivo (dCodRes=2605): si {@code reasonCode=1} ("Traslado por
 *     venta") y no se informa un documento asociado, SIFEN exige un campo alternativo (E506, fecha
 *     futura de emisión) que este dominio no modela; referenciar la factura real ya emitida ({@code
 *     gCamDEAsoc}, el mismo mecanismo que HU-14 ya usa para nota de crédito/débito) es la
 *     alternativa más correcta semánticamente. {@code null} para cualquier otro motivo de traslado.
 * @param transportTypeCode tipo de transporte ({@code iTipTrans}, E901, 1-2): 1=Propio, 2=Tercero —
 *     gap encontrado en vivo (dCodRes=2102): obligatorio para nota de remisión (C002=7) aunque
 *     {@code minOccurs="0"} en el propio XSD (mismo patrón de divergencia
 *     manual/schema-vs-regla-de-contenido ya visto varias veces en esta integración); nunca antes
 *     modelado, distinto de {@code responsibleCode} (quién emite el traslado) y de {@code
 *     freightResponsibleCode} (quién paga el flete).
 */
public record SifenGoodsRemissionData(
    int reasonCode,
    int responsibleCode,
    int estimatedKm,
    int transportModeCode,
    int freightResponsibleCode,
    String referencedControlNumber,
    int transportTypeCode) {}
