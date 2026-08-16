import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /** GET /api/health — comprueba base de datos y Redis. */
  @Get()
  async check() {
    const checks: Record<string, string> = {};

    try {
      await this.prisma.$queryRaw`SELECT 1`;
      checks.database = 'up';
    } catch {
      checks.database = 'down';
    }

    checks.redis = await this.pingRedis();

    const healthy = checks.database === 'up' && checks.redis === 'up';
    if (!healthy) {
      throw new ServiceUnavailableException({ status: 'degraded', ...checks });
    }

    return { status: 'ok', uptime: process.uptime(), ...checks };
  }

  /** Conexión fail-fast para el chequeo (no bloquea si Redis está caído). */
  private async pingRedis(): Promise<string> {
    const url = this.config.get<string>('REDIS_URL', 'redis://localhost:6379');
    // Espera a que la conexión se establezca (cola activa) con un presupuesto
    // corto de reintentos: ~1s antes de declarar Redis caído.
    const redis = new Redis(url, {
      retryStrategy: (times) => (times > 5 ? null : 200),
    });
    try {
      await redis.ping();
      return 'up';
    } catch {
      return 'down';
    } finally {
      redis.disconnect();
    }
  }
}
