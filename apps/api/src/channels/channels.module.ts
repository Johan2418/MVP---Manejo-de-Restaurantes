import { Module } from '@nestjs/common';
import { DomainEventsModule } from '../domain-events/domain-events.module';
import { ReservationsModule } from '../reservations/reservations.module';
import { ChannelsService } from './channels.service';
import { ConversationsController } from './conversations.controller';
import { TwilioService } from './twilio.service';
import { TwilioWebhooksController } from './twilio-webhooks.controller';

@Module({
  imports: [DomainEventsModule, ReservationsModule],
  controllers: [TwilioWebhooksController, ConversationsController],
  providers: [ChannelsService, TwilioService],
  exports: [ChannelsService, TwilioService],
})
export class ChannelsModule {}
