import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CreateGuestDto } from './dto/create-guest.dto';
import { UpdateGuestDto } from './dto/update-guest.dto';
import { GuestsService } from './guests.service';

@Controller('tenants/:tenantId/guests')
export class GuestsController {
  constructor(private readonly guests: GuestsService) {}

  /** GET /api/tenants/:tenantId/guests?q=... */
  @Get()
  list(@Param('tenantId') tenantId: string, @Query('q') q?: string) {
    return this.guests.list(tenantId, q);
  }

  /** POST /api/tenants/:tenantId/guests */
  @Post()
  create(@Param('tenantId') tenantId: string, @Body() dto: CreateGuestDto) {
    return this.guests.create(tenantId, dto);
  }

  /** PATCH /api/tenants/:tenantId/guests/:guestId */
  @Patch(':guestId')
  update(
    @Param('tenantId') tenantId: string,
    @Param('guestId') guestId: string,
    @Body() dto: UpdateGuestDto,
  ) {
    return this.guests.update(tenantId, guestId, dto);
  }
}
