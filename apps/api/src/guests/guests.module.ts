import { Module } from '@nestjs/common';
import { CRM_ADAPTER } from '../crm/crm.adapter';
import { GuestsController, RestaurantGuestsController } from './guests.controller';
import { GuestsService } from './guests.service';

@Module({
  controllers: [GuestsController, RestaurantGuestsController],
  providers: [
    GuestsService,
    // El CRM activo hoy es el propio (perfil de comensal en `Guest`); el token
    // permite cambiar a HubSpot/Zoho con una implementación nueva.
    { provide: CRM_ADAPTER, useExisting: GuestsService },
  ],
  exports: [GuestsService, CRM_ADAPTER],
})
export class GuestsModule {}
