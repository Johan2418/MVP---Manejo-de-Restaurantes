import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Redirect,
} from '@nestjs/common';
import { IntegrationProvider } from '@prisma/client';
import { ConnectCalDavDto } from './dto/connect-caldav.dto';
import { IntegrationsService } from './integrations.service';

/** Endpoints de integraciones, aislados por tenant/restaurante. */
@Controller('tenants/:tenantId/restaurants/:restaurantId/integrations')
export class IntegrationsController {
  constructor(private readonly integrations: IntegrationsService) {}

  /** GET .../integrations — integraciones del restaurante (sin credenciales). */
  @Get()
  list(
    @Param('tenantId') tenantId: string,
    @Param('restaurantId') restaurantId: string,
  ) {
    return this.integrations.list(tenantId, restaurantId);
  }

  /** POST .../integrations/google/connect — URL de autorización de Google. */
  @Post('google/connect')
  connect(
    @Param('tenantId') tenantId: string,
    @Param('restaurantId') restaurantId: string,
  ) {
    return this.integrations.getGoogleAuthUrl(tenantId, restaurantId);
  }

  /** POST .../integrations/google/disconnect — elimina la integración. */
  @Post('google/disconnect')
  async disconnectGoogle(
    @Param('tenantId') tenantId: string,
    @Param('restaurantId') restaurantId: string,
  ) {
    await this.integrations.disconnect(
      tenantId,
      restaurantId,
      IntegrationProvider.GOOGLE_CALENDAR,
    );
    return { ok: true };
  }

  /** POST .../integrations/caldav/connect — URL + credenciales CalDAV. */
  @Post('caldav/connect')
  connectCalDav(
    @Param('tenantId') tenantId: string,
    @Param('restaurantId') restaurantId: string,
    @Body() dto: ConnectCalDavDto,
  ) {
    return this.integrations.connectCalDav(tenantId, restaurantId, dto);
  }

  /** POST .../integrations/caldav/disconnect — elimina la integración. */
  @Post('caldav/disconnect')
  async disconnectCalDav(
    @Param('tenantId') tenantId: string,
    @Param('restaurantId') restaurantId: string,
  ) {
    await this.integrations.disconnect(
      tenantId,
      restaurantId,
      IntegrationProvider.CALDAV,
    );
    return { ok: true };
  }

  /** POST .../integrations/:integrationId/sync — sincronización manual. */
  @Post(':integrationId/sync')
  sync(
    @Param('tenantId') tenantId: string,
    @Param('restaurantId') restaurantId: string,
    @Param('integrationId') integrationId: string,
  ) {
    return this.integrations.syncNow(tenantId, restaurantId, integrationId);
  }
}

/** Callback OAuth de Google (URL registrada en Google Cloud Console). */
@Controller('integrations/google')
export class GoogleOAuthCallbackController {
  constructor(private readonly integrations: IntegrationsService) {}

  /** GET /api/integrations/google/callback?code=...&state=... */
  @Get('callback')
  @Redirect()
  async callback(
    @Query('code') code?: string,
    @Query('state') state?: string,
    @Query('error') error?: string,
  ) {
    if (error) {
      const fallback = 'http://localhost:3000';
      return { url: `${fallback}?error=google_oauth_${error}`, statusCode: 302 };
    }
    const { redirectUrl } = await this.integrations.handleGoogleCallback(code, state);
    return { url: redirectUrl, statusCode: 302 };
  }
}
