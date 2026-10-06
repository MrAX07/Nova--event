import type { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { UserError } from '../shared/text';
import { audit } from './audit';
import { normalizeGiveawayConfig } from './embeds';
import type { Actor } from './types';

export interface TemplateData {
  prize?: string;
  durationSec?: number;
  winnerCount?: number;
  config: Record<string, any>;
}

export function validateTemplateName(name: string): string {
  const n = name.trim();
  if (!/^[\p{L}\p{N} _-]{1,32}$/u.test(n)) throw new UserError('Skabelonnavne kan bruge bogstaver, tal, mellemrum, - og _ (maks. 32 tegn).');
  return n;
}

export async function saveTemplate(guildId: string, name: string, data: TemplateData, actor: Actor): Promise<void> {
  const n = validateTemplateName(name);
  const clean: TemplateData = {
    prize: data.prize?.slice(0, 250),
    durationSec: data.durationSec,
    winnerCount: data.winnerCount,
    config: normalizeGiveawayConfig(data.config) as unknown as Record<string, any>,
  };
  const existing = await prisma.template.findUnique({ where: { guildId_name: { guildId, name: n } } });
  await prisma.template.upsert({
    where: { guildId_name: { guildId, name: n } },
    create: { guildId, name: n, data: clean as unknown as Prisma.InputJsonValue, createdBy: actor.id },
    update: { data: clean as unknown as Prisma.InputJsonValue },
  });
  await audit({
    guildId,
    actorId: actor.id,
    action: 'GIVEAWAY_TEMPLATE_CREATED',
    targetType: 'TEMPLATE',
    targetId: n,
    before: existing ? { exists: true } : null,
    after: { prize: clean.prize ?? '—', duration: clean.durationSec ?? '—', winners: clean.winnerCount ?? '—' },
    source: actor.source,
  });
}

export async function getTemplate(guildId: string, name: string) {
  const t = await prisma.template.findFirst({ where: { guildId, name: { equals: name.trim(), mode: 'insensitive' } } });
  if (!t) throw new UserError(`Skabelonen **${name}** findes ikke. Brug \`/giveaway template list\` for at se alle skabeloner.`);
  return { ...t, data: t.data as unknown as TemplateData };
}

export async function deleteTemplate(guildId: string, name: string, actor: Actor): Promise<void> {
  const t = await getTemplate(guildId, name);
  await prisma.template.delete({ where: { id: t.id } });
  await audit({ guildId, actorId: actor.id, action: 'GIVEAWAY_TEMPLATE_DELETED', targetType: 'TEMPLATE', targetId: t.name, source: actor.source });
}

export const listTemplates = (guildId: string) => prisma.template.findMany({ where: { guildId }, orderBy: { name: 'asc' } });
