import { Controller, Get, Param, Query } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';

@Controller('tenants/:tenantId/restaurants/:restaurantId/analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  /** GET .../analytics/overview?days=14 — ocupación + canales + tasas. */
  @Get('overview')
  overview(
    @Param('tenantId') tenantId: string,
    @Param('restaurantId') restaurantId: string,
    @Query('days') days?: string,
  ) {
    return this.analytics.overview(
      tenantId,
      restaurantId,
      days ? Number(days) : 14,
    );
  }
}
