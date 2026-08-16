import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ChannelsModule } from '../channels/channels.module';
import { DomainEventsModule } from '../domain-events/domain-events.module';
import { ReservationsModule } from '../reservations/reservations.module';
import { RemindersProcessor } from './reminders.processor';
import { RemindersService } from './reminders.service';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'reminders' }),
    DomainEventsModule,
    ChannelsModule,
    ReservationsModule,
  ],
  providers: [RemindersService, RemindersProcessor],
  exports: [RemindersService],
})
export class RemindersModule {}
