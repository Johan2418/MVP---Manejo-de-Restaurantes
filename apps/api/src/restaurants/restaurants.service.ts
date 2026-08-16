import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRestaurantDto } from './dto/create-restaurant.dto';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { UpdateRestaurantDto } from './dto/update-restaurant.dto';

@Injectable()
export class RestaurantsService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------- Tenants ----------

  listTenants() {
    return this.prisma.tenant.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { restaurants: true } } },
    });
  }

  async createTenant(dto: CreateTenantDto) {
    const slug = dto.slug ?? this.slugify(dto.name);
    return this.prisma.tenant.create({ data: { name: dto.name, slug } });
  }

  // ---------- Restaurantes (siempre dentro de un tenant) ----------

  async assertTenantExists(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
    });
    if (!tenant) {
      throw new NotFoundException(`Tenant ${tenantId} no encontrado`);
    }
    return tenant;
  }

  listRestaurants(tenantId: string) {
    return this.prisma.restaurant.findMany({
      where: { tenantId },
      orderBy: { name: 'asc' },
      include: { _count: { select: { tables: true, reservations: true } } },
    });
  }

  async getRestaurant(tenantId: string, restaurantId: string) {
    await this.assertTenantExists(tenantId);
    const restaurant = await this.prisma.restaurant.findFirst({
      where: { id: restaurantId, tenantId },
    });
    if (!restaurant) {
      throw new NotFoundException(`Restaurante ${restaurantId} no encontrado`);
    }
    return restaurant;
  }

  createRestaurant(tenantId: string, dto: CreateRestaurantDto) {
    return this.prisma.restaurant.create({
      data: {
        tenantId,
        name: dto.name,
        timezone: dto.timezone,
        defaultDurationMinutes: dto.defaultDurationMinutes,
      },
    });
  }

  async updateRestaurant(
    tenantId: string,
    restaurantId: string,
    dto: UpdateRestaurantDto,
  ) {
    await this.getRestaurant(tenantId, restaurantId);
    return this.prisma.restaurant.update({
      where: { id: restaurantId },
      data: dto,
    });
  }

  async removeRestaurant(tenantId: string, restaurantId: string) {
    await this.getRestaurant(tenantId, restaurantId);
    // Cascade elimina mesas, horarios y reservas asociadas.
    await this.prisma.restaurant.delete({ where: { id: restaurantId } });
    return { deleted: true };
  }

  private slugify(name: string): string {
    return (
      name
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '') // quita tildes
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'tenant'
    );
  }
}
