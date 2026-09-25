import { describe, it, expect, afterEach } from 'vitest';
import { makeCtx } from './helpers';
import { AppError, ERR } from '@shared/types';

describe('inventory', () => {
  let cleanups: Array<() => void> = [];
  afterEach(() => { cleanups.forEach((c) => c()); cleanups = []; });

  it('opening stock, movements and balances reconcile', () => {
    const { ctx, cleanup } = makeCtx(); cleanups.push(cleanup);
    const item = ctx.services.inventory.createItem('t', { sku: 'GLOV-M', name: 'Gloves Medium', unit: 'box', cost: '450', minQuantity: 5, openingQuantity: 10 });
    expect(item.quantity).toBe(10);
    ctx.services.inventory.recordMovement('t', { itemId: item.id, type: 'purchase', qty: 10, unitCost: '450', reference: 'PO-1' });
    ctx.services.inventory.recordMovement('t', { itemId: item.id, type: 'stock_out', qty: 12 });
    const after = ctx.services.inventory.get(item.id);
    expect(after.quantity).toBe(8);
    const moves = ctx.services.inventory.movementsFor(item.id);
    expect(moves.total).toBe(3);
    expect(moves.rows[0].balanceAfter).toBe(8);
    const diag = ctx.services.diagnostics.run();
    expect(diag.issues.filter((i) => i.area === 'inventory')).toHaveLength(0);
  });

  it('negative stock is impossible', () => {
    const { ctx, cleanup } = makeCtx(); cleanups.push(cleanup);
    const item = ctx.services.inventory.createItem('t', { sku: 'ANES', name: 'Anesthesia cartridges', openingQuantity: 3 });
    try {
      ctx.services.inventory.recordMovement('t', { itemId: item.id, type: 'stock_out', qty: 4 });
      expect.unreachable();
    } catch (e) {
      expect((e as AppError).code).toBe(ERR.CONFLICT);
    }
    // Balance unchanged after failed movement.
    expect(ctx.services.inventory.get(item.id).quantity).toBe(3);
    expect(ctx.services.inventory.movementsFor(item.id).total).toBe(1);
  });

  it('corrections take an explicit sign', () => {
    const { ctx, cleanup } = makeCtx(); cleanups.push(cleanup);
    const item = ctx.services.inventory.createItem('t', { sku: 'COMP-A2', name: 'Composite A2', openingQuantity: 10 });
    ctx.services.inventory.recordMovement('t', { itemId: item.id, type: 'correction', qty: -2, notes: 'damaged syringes' });
    expect(ctx.services.inventory.get(item.id).quantity).toBe(8);
  });

  it('low stock and expiry flags are computed', () => {
    const { ctx, cleanup } = makeCtx(); cleanups.push(cleanup);
    const item = ctx.services.inventory.createItem('t', { sku: 'FLUOR', name: 'Fluoride varnish', openingQuantity: 2, minQuantity: 3, expiryDate: '2026-10-01' });
    expect(item.lowStock).toBe(true);
    expect(item.expiringSoon).toBe(true);
    const list = ctx.services.inventory.list({ lowStockOnly: true });
    expect(list.total).toBe(1);
  });

  it('notifications are generated from real low-stock data', () => {
    const { ctx, cleanup } = makeCtx(); cleanups.push(cleanup);
    ctx.services.inventory.createItem('t', { sku: 'ETC-37', name: 'Etchant 37%', openingQuantity: 1, minQuantity: 4 });
    ctx.services.notifications.refresh();
    const list = ctx.services.notifications.list(true);
    expect(list.some((n) => n.type === 'inventory.low_stock' && n.title.includes('Etchant'))).toBe(true);
  });
});
