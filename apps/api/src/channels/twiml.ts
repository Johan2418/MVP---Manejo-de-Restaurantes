/**
 * Helpers de TwiML (Fase 2/3 — voz).
 * Comparten los webhooks de llamadas entrantes (IVR) y los recordatorios por
 * llamada saliente (Fase 3), para que el texto hablado sea consistente.
 */

/** Escapa texto para XML/TwiML. */
export function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Nodo <Say> con voz hispana. */
export function say(text: string): string {
  return `<Say voice="alice" language="es-MX">${esc(text)}</Say>`;
}

/** Envuelve el contenido en el <Response> raíz de TwiML. */
export function twiml(inner: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`;
}

/**
 * TwiML de una llamada de recordatorio saliente: saludo con los datos de la
 * reserva + <Gather> para confirmar (1) o cancelar (2) + despedida si no
 * responde. `menuUrl` es el webhook al que Twilio reenvía los dígitos.
 */
export function reminderCallTwiML(text: string, menuUrl: string): string {
  return twiml(`
    ${say(text)}
    <Gather numDigits="1" action="${esc(menuUrl)}" method="POST" timeout="8">
      ${say('Presione 1 para confirmar su reserva, o 2 para cancelarla.')}
    </Gather>
    ${say('No recibimos ninguna opción. Gracias por su atención. Hasta luego.')}
  `);
}
