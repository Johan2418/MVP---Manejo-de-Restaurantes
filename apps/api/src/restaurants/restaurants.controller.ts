import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { CreateRestaurantDto } from './dto/create-restaurant.dto';
import { UpdateRestaurantDto } from './dto/update-restaurant.dto';
import { RestaurantsService } from './restaurants.service';

@Controller('tenants/:tenantId/restaurants')
export class RestaurantsController {
  constructor(private readonly restaurants: RestaurantsService) {}

  /** GET /api/tenants/:tenantId/restaurants */
  @Get()
  list(@Param('tenantId') tenantId: string) {
    return this.restaurants.listRestaurants(tenantId);
  }

  /** POST /api/tenants/:tenantId/restaurants */
  @Post()
  create(
    @Param('tenantId') tenantId: string,
    @Body() dto: CreateRestaurantDto,
  ) {
    return this.restaurants.createRestaurant(tenantId, dto);
  }

  /** GET /api/tenants/:tenantId/restaurants/:restaurantId */
  @Get(':restaurantId')
  get(
    @Param('tenantId') tenantId: string,
    @Param('restaurantId') restaurantId: string,
  ) {
    return this.restaurants.getRestaurant(tenantId, restaurantId);
  }

  /** PATCH /api/tenants/:tenantId/restaurants/:restaurantId */
  @Patch(':restaurantId')
  update(
    @Param('tenantId') tenantId: string,
    @Param('restaurantId') restaurantId: string,
    @Body() dto: UpdateRestaurantDto,
  ) {
    return this.restaurants.updateRestaurant(tenantId, restaurantId, dto);
  }

  /** DELETE /api/tenants/:tenantId/restaurants/:restaurantId */
  @Delete(':restaurantId')
  remove(
    @Param('tenantId') tenantId: string,
    @Param('restaurantId') restaurantId: string,
  ) {
    return this.restaurants.removeRestaurant(tenantId, restaurantId);
  }
}
