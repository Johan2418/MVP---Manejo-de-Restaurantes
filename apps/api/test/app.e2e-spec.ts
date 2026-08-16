import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

/**
 * Smoke test end-to-end: requiere PostgreSQL y Redis levantados
 * (docker compose up -d) y el seed aplicado (npm run db:seed).
 */
describe('App (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/health → status ok (DB + Redis)', () => {
    return request(app.getHttpServer())
      .get('/api/health')
      .expect(200)
      .expect((res) => {
        expect(res.body.status).toBe('ok');
      });
  });

  it('GET /api/tenants → lista el tenant del seed', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/tenants')
      .expect(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(
      res.body.some((t: { slug: string }) => t.slug === 'la-terraza'),
    ).toBe(true);
  });

  it('POST /api/tenants/:tenantId/restaurants → 201 con cuerpo válido', async () => {
    const tenants = await request(app.getHttpServer())
      .get('/api/tenants')
      .expect(200);
    const tenant = tenants.body.find(
      (t: { slug: string }) => t.slug === 'la-terraza',
    );
    expect(tenant).toBeDefined();

    const res = await request(app.getHttpServer())
      .post(`/api/tenants/${tenant.id}/restaurants`)
      .send({ name: 'Sucursal Norte (e2e)' })
      .expect(201);
    expect(res.body.name).toBe('Sucursal Norte (e2e)');

    await request(app.getHttpServer())
      .delete(`/api/tenants/${tenant.id}/restaurants/${res.body.id}`)
      .expect(200);
  });

  it('POST reserva inválida (sin comensal) → 400', async () => {
    const tenants = await request(app.getHttpServer())
      .get('/api/tenants')
      .expect(200);
    const tenant = tenants.body.find(
      (t: { slug: string }) => t.slug === 'la-terraza',
    );
    const restaurants = await request(app.getHttpServer())
      .get(`/api/tenants/${tenant.id}/restaurants`)
      .expect(200);
    const restaurant = restaurants.body.find(
      (r: { name: string }) => r.name === 'La Terraza Centro',
    );

    await request(app.getHttpServer())
      .post(
        `/api/tenants/${tenant.id}/restaurants/${restaurant.id}/reservations`,
      )
      .send({ startsAt: new Date().toISOString(), partySize: 2 })
      .expect(400);
  });
});
