import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { CreateTableDto } from './dto/create-table.dto';
import { UpdateTableDto } from './dto/update-table.dto';
import { TablesService } from './tables.service';

@Controller('tenants/:tenantId/restaurants/:restaurantId/tables')
export class TablesController {
  constructor(private readonly tables: TablesService) {}

  /** GET /api/tenants/:tenantId/restaurants/:restaurantId/tables */
  @Get()
  list(
    @Param('tenantId') tenantId: string,
    @Param('restaurantId') restaurantId: string,
  ) {
    return this.tables.list(tenantId, restaurantId);
  }

  /** POST /api/tenants/:tenantId/restaurants/:restaurantId/tables */
  @Post()
  create(
    @Param('tenantId') tenantId: string,
    @Param('restaurantId') restaurantId: string,
    @Body() dto: CreateTableDto,
  ) {
    return this.tables.create(tenantId, restaurantId, dto);
  }

  /** PATCH /api/tenants/:tenantId/restaurants/:restaurantId/tables/:tableId */
  @Patch(':tableId')
  update(
    @Param('tenantId') tenantId: string,
    @Param('restaurantId') restaurantId: string,
    @Param('tableId') tableId: string,
    @Body() dto: UpdateTableDto,
  ) {
    return this.tables.update(tenantId, restaurantId, tableId, dto);
  }

  /** DELETE .../tables/:tableId (baja lógica) */
  @Delete(':tableId')
  remove(
    @Param('tenantId') tenantId: string,
    @Param('restaurantId') restaurantId: string,
    @Param('tableId') tableId: string,
  ) {
    return this.tables.remove(tenantId, restaurantId, tableId);
  }
}
