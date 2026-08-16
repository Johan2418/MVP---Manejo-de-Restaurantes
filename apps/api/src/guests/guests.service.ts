import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateGuestDto } from './dto/create-guest.dto';
import { UpdateGuestDto } from './dto/update-guest.dto';

@Injectable()
export class GuestsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Búsqueda por nombre o teléfono dentro del tenant. */
  list(tenantId: string, q?: string) {
    return this.prisma.guest.findMany({
      where: {
        tenantId,
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: 'insensitive' } },
                { phone: { contains: q } },
              ],
            }
          : {}),
      },
      orderBy: { name: 'asc' },
      include: { _count: { select: { reservations: true } } },
    });
  }

  /**
   * CRM propio — comensales con actividad en un restaurante concreto
   * (Fase 4). Devuelve visitas, última reserva y su estado para el panel.
   */
  listByRestaurant(tenantId: string, restaurantId: string, q?: string) {
    return this.prisma.guest.findMany({
      where: {
        tenantId,
        reservations: { some: { restaurantId } },
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: 'insensitive' } },
                { phone: { contains: q } },
              ],
            }
          : {}),
      },
      orderBy: { updatedAt: 'desc' },
      include: {
        _count: {
          select: { reservations: { where: { restaurantId } } },
        },
        reservations: {
          where: { restaurantId },
          orderBy: { startsAt: 'desc' },
          take: 1,
          select: { startsAt: true, status: true },
        },
      },
    });
  }

  /**
   * CRM propio — perfil completo del comensal: datos, historial de reservas
   * del restaurante y conversaciones (Fase 4).
   */
  async profile(tenantId: string, restaurantId: string, guestId: string) {
    const guest = await this.prisma.guest.findFirst({
      where: { id: guestId, tenantId },
    });
    if (!guest) {
      throw new NotFoundException(`Comensal ${guestId} no encontrado`);
    }
    const [reservations, conversations] = await Promise.all([
      this.prisma.reservation.findMany({
        where: { guestId, restaurantId },
        include: { table: true },
        orderBy: { startsAt: 'desc' },
      }),
      this.prisma.conversation.findMany({
        where: { guestId, restaurantId },
        orderBy: { lastMessageAt: 'desc' },
        include: {
          messages: { orderBy: { sentAt: 'desc' }, take: 5 },
        },
      }),
    ]);
    return { ...guest, reservations, conversations };
  }

  async getOne(tenantId: string, guestId: string) {
    const guest = await this.prisma.guest.findFirst({
      where: { id: guestId, tenantId },
    });
    if (!guest) {
      throw new NotFoundException(`Comensal ${guestId} no encontrado`);
    }
    return guest;
  }

  async create(tenantId: string, dto: CreateGuestDto) {
    const existing = await this.prisma.guest.findUnique({
      where: { tenantId_phone: { tenantId, phone: dto.phone } },
    });
    if (existing) {
      throw new ConflictException(
        `Ya existe un comensal con el teléfono ${dto.phone}`,
      );
    }
    return this.prisma.guest.create({
      data: {
        tenantId,
        name: dto.name,
        phone: dto.phone,
        email: dto.email,
        notes: dto.notes,
        preferences: dto.preferences,
        consent: dto.consent ?? false,
      },
    });
  }

  async update(tenantId: string, guestId: string, dto: UpdateGuestDto) {
    await this.getOne(tenantId, guestId);
    return this.prisma.guest.update({ where: { id: guestId }, data: dto });
  }
}
