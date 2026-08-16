/**
 * Contrato del CRM (Fase 4 — Integraciones, adaptador CRM).
 *
 * El plan contempla HubSpot/Zoho o un CRM propio. Hoy el CRM propio es la
 * implementación activa: el perfil del comensal vive en el modelo `Guest`
 * (historial de reservas, conversaciones, preferencias, consentimiento LOPDP)
 * y se consume desde el panel. Si mañana se conecta HubSpot/Zoho, basta con
 * una implementación nueva de este contrato y cambiar el proveedor.
 */

/** Perfil de comensal que cualquier CRM debe saber exponer. */
export interface CrmGuestProfile {
  id: string;
  name: string;
  phone: string;
  email?: string | null;
  notes?: string | null;
  preferences?: string | null;
  consent: boolean;
  visits: number;
  /** Última reserva en el restaurante. */
  lastReservationAt?: Date | null;
  lastReservationStatus?: string | null;
}

export interface CrmAdapter {
  /** Comensales del restaurante con búsqueda por nombre/teléfono. */
  listGuests(
    tenantId: string,
    restaurantId: string,
    q?: string,
  ): Promise<CrmGuestProfile[]>;

  /** Perfil completo del comensal (datos + historial de reservas y chats). */
  getGuest(
    tenantId: string,
    restaurantId: string,
    guestId: string,
  ): Promise<CrmGuestProfile>;
}

/** Token de inyección del adaptador CRM activo. */
export const CRM_ADAPTER = 'CRM_ADAPTER';
