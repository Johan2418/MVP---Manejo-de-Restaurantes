import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTableDto } from './dto/create-table.dto';
import { UpdateTableDto } from './dto/update-table.dto';

@Injectable()
export class TablesService {
  constructor(private readonly prisma: PrismaService) {}

  /** El restaurante debe existir y pertenecer al tenant (aislamiento). */
  async assertRestaurantInTenant(tenantId: string, restaurantId: string) {
    const restaurant = await this.prisma.restaurant.findFirst({
      where: { id: restaurantId, tenantId },
    });
    if (!restaurant) {
      throw new NotFoundException(
        `Restaurante ${restaurantId} no encontrado en este tenant`,
      );
    }
    return restaurant;
  }

  async list(tenantId: string, restaurantId: string) {
    await this.assertRestaurantInTenant(tenantId, restaurantId);
    return this.prisma.table.findMany({
      where: { restaurantId },
      orderBy: [{ zone: 'asc' }, { name: 'asc' }],
    });
  }

  async getOne(tenantId: string, restaurantId: string, tableId: string) {
    await this.assertRestaurantInTenant(tenantId, restaurantId);
    const table = await this.prisma.table.findFirst({
      where: { id: tableId, restaurantId },
    });
    if (!table) {
      throw new NotFoundException(`Mesa ${tableId} no encontrada`);
    }
    return table;
  }

  async create(
    tenantId: string,
    restaurantId: string,
    dto: CreateTableDto,
  ) {
    await this.assertRestaurantInTenant(tenantId, restaurantId);
    return this.prisma.table.create({
      data: {
        restaurantId,
        name: dto.name,
        capacity: dto.capacity,
        zone: dto.zone,
        isActive: dto.isActive,
      },
    });
  }

  async update(
    tenantId: string,
    restaurantId: string,
    tableId: string,
    dto: UpdateTableDto,
  ) {
    await this.getOne(tenantId, restaurantId, tableId);
    return this.prisma.table.update({ where: { id: tableId }, data: dto });
  }

  /** Baja lógica: conserva el historial de reservas. */
  async remove(tenantId: string, restaurantId: string, tableId: string) {
    await this.getOne(tenantId, restaurantId, tableId);
    return this.prisma.table.update({
      where: { id: tableId },
      data: { isActive: false },
    });
  }
}
