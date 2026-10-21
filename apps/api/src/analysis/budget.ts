import { Prisma, type PrismaClient } from '../generated/prisma/client';
import { AppError } from '../http/errors';
export interface BudgetGrant { reservationId: string; pages: number; amountMicroUsd: number }
export class BudgetService {
  constructor(private readonly db: PrismaClient, private readonly limitMicroUsd: number, private readonly priceMicroUsdPerPage: number | null, private readonly now = Date.now) {}
  async reserveBudget(attemptId: string, leaseId: string, pages: number): Promise<BudgetGrant> {
    const price = this.priceMicroUsdPerPage;
    if (!price || !Number.isSafeInteger(price) || price <= 0) throw new AppError('PRICE_NOT_CONFIRMED', 503);
    if (!Number.isInteger(pages) || pages < 1 || pages > 100 || !Number.isInteger(this.limitMicroUsd) || this.limitMicroUsd < 1 || this.limitMicroUsd > 20_000_000) throw new AppError('INVALID_BUDGET_REQUEST');
    return this.db.$transaction(async tx => {
      await tx.$queryRaw(Prisma.sql`SELECT true AS locked FROM pg_advisory_xact_lock(90133702)`);
      const current = await tx.analysisAttempt.findFirst({ where: { id: attemptId, leaseId, provider: 'upstage', status: 'PROCESSING', deadline: { gt: new Date(this.now()) } } });
      if (!current) throw new AppError('INVALID_ANALYSIS_LEASE', 403);
      const previous = await tx.budgetLedger.findUnique({ where: { attemptId } });
      if (previous) {
        if (previous.pages !== pages) throw new AppError('BUDGET_RESERVATION_MISMATCH', 409);
        return { reservationId: previous.id, pages, amountMicroUsd: previous.amountMicroUsd };
      }
      const counter = await tx.budgetCounter.upsert({ where: { id: 'development-upstage' }, create: { id: 'development-upstage' }, update: {} });
      const amountMicroUsd = pages * price;
      if (!Number.isSafeInteger(amountMicroUsd) || counter.spentMicroUsd + amountMicroUsd > this.limitMicroUsd) throw new AppError('BUDGET_EXCEEDED', 429);
      await tx.budgetCounter.update({ where: { id: counter.id }, data: { spentMicroUsd: { increment: amountMicroUsd } } });
      const ledger = await tx.budgetLedger.create({ data: { attemptId, pages, amountMicroUsd } });
      return { reservationId: ledger.id, pages, amountMicroUsd };
    });
  }
}
