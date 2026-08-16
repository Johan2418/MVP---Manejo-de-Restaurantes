-- AlterTable: canal del recordatorio automático (Fase 3 — voz).
ALTER TABLE "restaurants" ADD COLUMN "reminderChannel" "Channel" NOT NULL DEFAULT 'WHATSAPP';
