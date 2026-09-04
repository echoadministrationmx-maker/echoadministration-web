# Echo Administración — Flujos WhatsApp de Cobranza

## Objetivo
Atender a residentes que escriben a Echo y ofrecer rutas de pago consistentes. Esta primera versión es operativa/manual: no envía mensajes automáticamente ni modifica la base de datos.

## Menú inicial
Hola 👋 Soy el asistente de Echo Administración. ¿Cómo podemos ayudarte?

1. Consultar mi saldo
2. Pagar mantenimiento
3. Ver opciones para regularizar mi adeudo
4. Consultar mi convenio activo
5. Hablar con administración

## Flujo: regularización
Antes de mostrar datos financieros, validar al residente con la información definida por administración. No revelar saldo únicamente por coincidencia de teléfono.

Una vez validado:

Tu cuota corriente es de **$515** y tu adeudo histórico es de **$[SALDO]**.

Podemos ayudarte a regularizarlo sin dejar de cubrir tu mantenimiento actual:

- **Echo Rápido — 3 meses:** $[TOTAL_3] al mes, incluyendo cuota corriente.
- **Echo Regulariza — 6 meses ⭐:** $[TOTAL_6] al mes, incluyendo cuota corriente.
- **Echo Flexible — 12 meses:** $[TOTAL_12] al mes, incluyendo cuota corriente.
- **Modalidad quincenal:** disponible sobre el plan seleccionado.

¿Quieres que revisemos alguna de estas opciones contigo?

## Echo Social
No se ofrece ni aprueba automáticamente. Si la persona indica que ninguna alternativa es sostenible:

“Entendemos. Podemos revisar una alternativa de regularización adaptada a tu situación. Voy a canalizar tu caso con administración para evaluar una mensualidad sostenible.”

Estado interno: `requiere_revision_social`.

## Reglas
- El convenio cubre deuda histórica; la cuota corriente continúa pagándose.
- No prometer descuentos, condonaciones ni cambios de moratorios sin autorización.
- No activar convenio sin aceptación y primer pago conforme a las reglas aprobadas.
- No mostrar información financiera antes de validar identidad/unidad.
- Si existe un convenio activo, mostrar primero ese convenio y no ofrecer uno nuevo automáticamente.
- Cualquier disputa de saldo pasa a humano.
- Jurídico, amenazas, vulnerabilidad o conflicto pasan a humano.

## Estados sugeridos
`nuevo_contacto`
`identidad_pendiente`
`identidad_validada`
`saldo_consultado`
`plan_3_ofrecido`
`plan_6_ofrecido`
`plan_12_ofrecido`
`requiere_revision_social`
`promesa_pago`
`convenio_pendiente_aceptacion`
`convenio_activo`
`requiere_humano`

## Próxima fase técnica
1. Conectar WhatsApp Business Platform / Cloud API.
2. Webhook de entrada.
3. Resolver teléfono → residente, seguido de validación de identidad.
4. Consultar saldo y convenio en Supabase desde backend seguro.
5. Usar `cobranza/planes.js` para las propuestas.
6. Registrar conversación/estado.
7. Generar link de pago.
8. Después del primer pago, activar convenio.
