import { Body, Controller, Get, Post } from '@nestjs/common';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { RestaurantsService } from './restaurants.service';

@Controller('tenants')
export class TenantsController {
  constructor(private readonly restaurants: RestaurantsService) {}

  /** GET /api/tenants */
  @Get()
  list() {
    return this.restaurants.listTenants();
  }

  /** POST /api/tenants */
  @Post()
  create(@Body() dto: CreateTenantDto) {
    return this.restaurants.createTenant(dto);
  }
}
