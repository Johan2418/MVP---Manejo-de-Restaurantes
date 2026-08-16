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
