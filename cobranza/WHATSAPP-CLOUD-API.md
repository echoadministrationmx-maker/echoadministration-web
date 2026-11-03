# Echo — WhatsApp Business Platform / Cloud API

## Estado
La infraestructura de recepción está preparada, pero **no se activa ningún bot ni envío automático hasta conectar el número de Echo en Meta Business Platform y configurar los secretos en Vercel**.

## Endpoint
`/api/whatsapp/webhook`

El endpoint:
- responde al challenge de verificación de Meta;
- valida `X-Hub-Signature-256` con el App Secret;
- recibe mensajes entrantes;
- normaliza el teléfono;
- intenta relacionarlo con `residentes`;
- crea/actualiza la conversación en Supabase;
- guarda el mensaje para trazabilidad;
- no revela saldos y no envía respuestas todavía.

## Variables de entorno requeridas en Vercel
- `WHATSAPP_VERIFY_TOKEN`
- `META_APP_SECRET`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Nunca guardar estos valores en GitHub ni exponer `SUPABASE_SERVICE_ROLE_KEY` en código cliente.

## Supabase preparado
- `whatsapp_conversations`
- `whatsapp_messages`
- `whatsapp_resolver_telefono(text)` — solo `service_role`

Las tablas tienen RLS habilitado y no tienen acceso directo para `anon`/`authenticated`.

## Siguiente activación
1. Registrar/conectar el número en WhatsApp Business Platform.
2. Configurar el webhook de Meta con la URL de producción.
3. Agregar las variables de entorno en Vercel.
4. Suscribir el webhook a mensajes.
5. Enviar un mensaje de prueba al número.
6. Confirmar que aparece en `whatsapp_conversations` y `whatsapp_messages`.
7. Solo después habilitar respuestas automáticas, plantillas y envíos salientes.

## Regla Echo
El bot nunca negocia excepciones ni descuentos fuera de las reglas aprobadas. Disputa de saldo, jurídico, vulnerabilidad o solicitud especial pasa a humano.
