import { Module } from '@nestjs/common';
import { RestaurantsController } from './restaurants.controller';
import { RestaurantsService } from './restaurants.service';
import { TenantsController } from './tenants.controller';

@Module({
  controllers: [RestaurantsController, TenantsController],
  providers: [RestaurantsService],
})
export class RestaurantsModule {}
