import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
} from '@nestjs/common';
import { ChannelsService } from './channels.service';
import { ReplyMessageDto } from './dto/reply-message.dto';

@Controller('tenants/:tenantId/restaurants/:restaurantId/conversations')
export class ConversationsController {
  constructor(private readonly channels: ChannelsService) {}

  /** GET .../conversations — hilos con último mensaje y no-leídos. */
  @Get()
  list(
    @Param('tenantId') tenantId: string,
    @Param('restaurantId') restaurantId: string,
  ) {
    return this.channels.listConversations(tenantId, restaurantId);
  }

  /** GET .../conversations/:conversationId/messages — hilo completo. */
  @Get(':conversationId/messages')
  messages(
    @Param('tenantId') tenantId: string,
    @Param('restaurantId') restaurantId: string,
    @Param('conversationId') conversationId: string,
  ) {
    return this.channels.listMessages(tenantId, restaurantId, conversationId);
  }

  /** POST .../conversations/:conversationId/read — marca como leído. */
  @Post(':conversationId/read')
  @HttpCode(200)
  markRead(
    @Param('tenantId') tenantId: string,
    @Param('restaurantId') restaurantId: string,
    @Param('conversationId') conversationId: string,
  ) {
    return this.channels.markRead(tenantId, restaurantId, conversationId);
  }

  /** POST .../conversations/:conversationId/reply — respuesta saliente (SMS/WhatsApp). */
  @Post(':conversationId/reply')
  reply(
    @Param('tenantId') tenantId: string,
    @Param('restaurantId') restaurantId: string,
    @Param('conversationId') conversationId: string,
    @Body() dto: ReplyMessageDto,
  ) {
    return this.channels.reply(tenantId, restaurantId, conversationId, dto.body);
  }
}
