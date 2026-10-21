import { Prisma, type PrismaClient } from '../generated/prisma/client';
import { AppError } from '../http/errors';
import { validateInternal } from '@agentfit/contracts';
export interface SolarBudgetRequest { scope: 'analysis' | 'discovery'; targetId: string; leaseId: string; operation: 'extract' | 'review' | 'needs' | 'rank'; inputBytes: number; outputTokens: number }
export class SolarBudgetService {
  constructor(private readonly db: PrismaClient, private readonly limitMicroUsd: number, private readonly now = Date.now) {}
  async reserve(raw: unknown) {
    const body = validateInternal<SolarBudgetRequest>('solarBudgetRequest', raw);
    if (!Number.isSafeInteger(this.limitMicroUsd) || this.limitMicroUsd < 1 || this.limitMicroUsd > 20000000) throw new AppError('INVALID_BUDGET_CONFIGURATION');
    if ((body.scope === 'analysis') !== ['extract', 'review'].includes(body.operation)) throw new AppError('INVALID_BUDGET_REQUEST');
    // UTF8 bytes + framing allowance bound input tokens; standard rates + VAT, without temporary discounts.
    const amountMicroUsd = Math.ceil(((body.inputBytes + 1024) * 3 + body.outputTokens * 12) * 11 / 100);
    return this.db.$transaction(async tx => {
      await tx.$queryRaw(Prisma.sql`SELECT true AS locked FROM pg_advisory_xact_lock(90133702)`);
      const lease = body.scope === 'analysis'
        ? await tx.analysisAttempt.findFirst({ where: { id: body.targetId, leaseId: body.leaseId, status: 'PROCESSING', provider: { in: body.operation === 'extract' ? ['solar'] : ['upstage'] }, deadline: { gt: new Date(this.now()) }, project: { deletingAt: null } } })
        : await tx.skillDiscovery.findFirst({ where: { id: body.targetId, leaseId: body.leaseId, status: { in: ['SEARCHING', 'CHECKING'] }, deadline: { gt: new Date(this.now()) }, project: { deletingAt: null } } });
      if (!lease) throw new AppError('INVALID_ANALYSIS_LEASE', 403);
      const id = `${body.scope}-${body.targetId}-${body.operation}`;
      const previous = await tx.solarBudgetReservation.findUnique({ where: { id } });
      if (previous) {
        if (previous.inputBytes !== body.inputBytes || previous.outputTokens !== body.outputTokens) throw new AppError('BUDGET_RESERVATION_MISMATCH', 409);
        return { reservationId: previous.id, amountMicroUsd: previous.amountMicroUsd };
      }
      const counter = await tx.budgetCounter.upsert({ where: { id: 'development-upstage' }, create: { id: 'development-upstage' }, update: {} });
      if (counter.spentMicroUsd + amountMicroUsd > this.limitMicroUsd) throw new AppError('BUDGET_EXCEEDED', 429);
      await tx.budgetCounter.update({ where: { id: counter.id }, data: { spentMicroUsd: { increment: amountMicroUsd } } });
      await tx.solarBudgetReservation.create({ data: { id, projectId: lease.projectId, inputBytes: body.inputBytes, outputTokens: body.outputTokens, amountMicroUsd } });
      return { reservationId: id, amountMicroUsd };
    });
  }
}
