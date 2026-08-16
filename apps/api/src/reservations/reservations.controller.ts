import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CreateReservationDto } from './dto/create-reservation.dto';
import { TransitionReservationDto } from './dto/transition-reservation.dto';
import { UpdateReservationDto } from './dto/update-reservation.dto';
import { ReservationsService } from './reservations.service';

@Controller('tenants/:tenantId/restaurants/:restaurantId/reservations')
export class ReservationsController {
  constructor(private readonly reservations: ReservationsService) {}

  /** GET .../reservations?date=YYYY-MM-DD */
  @Get()
  list(
    @Param('tenantId') tenantId: string,
    @Param('restaurantId') restaurantId: string,
    @Query('date') date: string,
  ) {
    return this.reservations.listByDate(tenantId, restaurantId, date);
  }

  /** POST .../reservations */
  @Post()
  create(
    @Param('tenantId') tenantId: string,
    @Param('restaurantId') restaurantId: string,
    @Body() dto: CreateReservationDto,
  ) {
    return this.reservations.create(tenantId, restaurantId, dto);
  }

  /** GET .../reservations/:id */
  @Get(':id')
  get(
    @Param('tenantId') tenantId: string,
    @Param('restaurantId') restaurantId: string,
    @Param('id') id: string,
  ) {
    return this.reservations.get(tenantId, restaurantId, id);
  }

  /** PATCH .../reservations/:id (reprogramar) */
  @Patch(':id')
  update(
    @Param('tenantId') tenantId: string,
    @Param('restaurantId') restaurantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateReservationDto,
  ) {
    return this.reservations.update(tenantId, restaurantId, id, dto);
  }

  /** POST .../reservations/:id/transition */
  @Post(':id/transition')
  transition(
    @Param('tenantId') tenantId: string,
    @Param('restaurantId') restaurantId: string,
    @Param('id') id: string,
    @Body() dto: TransitionReservationDto,
  ) {
    return this.reservations.transition(tenantId, restaurantId, id, dto);
  }

  /**
   * POST .../reservations/auto-assign (Fase 5): asigna mesas a las reservas
   * activas sin mesa. Se dispara solo también al confirmar/liberar mesas.
   */
  @Post('auto-assign')
  autoAssign(
    @Param('tenantId') tenantId: string,
    @Param('restaurantId') restaurantId: string,
  ) {
    return this.reservations.autoAssign(tenantId, restaurantId);
  }
}
