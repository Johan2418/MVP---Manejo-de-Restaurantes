import { Module } from '@nestjs/common';
import { DomainEventsModule } from '../domain-events/domain-events.module';
import { ReservationsModule } from '../reservations/reservations.module';
import { ChatbotService } from './chatbot.service';
import { ChannelsService } from './channels.service';
import { ConversationsController } from './conversations.controller';
import { TwilioService } from './twilio.service';
import { TwilioWebhooksController } from './twilio-webhooks.controller';
import { VoiceAiService } from './voice-ai.service';

@Module({
  imports: [DomainEventsModule, ReservationsModule],
  controllers: [TwilioWebhooksController, ConversationsController],
  providers: [ChannelsService, TwilioService, ChatbotService, VoiceAiService],
  exports: [ChannelsService, TwilioService, VoiceAiService],
})
export class ChannelsModule {}
