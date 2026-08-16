import { Module } from '@nestjs/common';
import { DomainEventsModule } from '../domain-events/domain-events.module';
import { TablesModule } from '../tables/tables.module';
import { AvailabilityController } from './availability.controller';
import { ReservationsController } from './reservations.controller';
import { ReservationsService } from './reservations.service';

@Module({
  imports: [TablesModule, DomainEventsModule],
  controllers: [ReservationsController, AvailabilityController],
  providers: [ReservationsService],
})
export class ReservationsModule {}
