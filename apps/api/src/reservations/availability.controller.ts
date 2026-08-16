import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Query,
} from '@nestjs/common';
import { ReservationsService } from './reservations.service';

@Controller('tenants/:tenantId/restaurants/:restaurantId/availability')
export class AvailabilityController {
  constructor(private readonly reservations: ReservationsService) {}

  /**
   * GET /api/tenants/:tenantId/restaurants/:restaurantId/availability
   *   ?date=YYYY-MM-DD&partySize=2&duration=90
   */
  @Get()
  availability(
    @Param('tenantId') tenantId: string,
    @Param('restaurantId') restaurantId: string,
    @Query('date') date: string,
    @Query('partySize', ParseIntPipe) partySize: number,
    @Query('duration', new ParseIntPipe({ optional: true })) duration?: number,
  ) {
    return this.reservations.getAvailability(
      tenantId,
      restaurantId,
      date,
      partySize,
      duration,
    );
  }
}
