import type Database from 'better-sqlite3';
import { AppError, ERR, InventoryMovementType, Paisa, Page } from '@shared/types';
import { parsePositiveMoney } from '../domain/money';
import { nowUtc, isValidLocalDate, addDays, todayLocal } from '../domain/datetime';
import { AuditService } from './audit';

export interface InventoryItemRow {
  id: number;
  sku: string;
  name: string;
  category: string;
  supplier: string;
  unit: string;
  cost: Paisa;
  price: Paisa;
  quantity: number;
  minQuantity: number;
  expiryDate: string | null;
  batch: string;
  active: boolean;
  notes: string;
  lowStock: boolean;
  expiringSoon: boolean;
}

export interface InventoryItemInput {
  sku: string;
  name: string;
  category?: string;
  supplier?: string;
  unit?: string;
  cost?: string | number;
  price?: string | number;
  minQuantity?: number;
  expiryDate?: string | null;
  batch?: string;
  active?: boolean;
  notes?: string;
}

export interface MovementRow {
  id: number;
  itemId: number;
  type: InventoryMovementType;
  qty: number;
  unitCost: Paisa;
  balanceAfter: number;
  reference: string;
  notes: string;
  createdBy: string;
  createdAt: string;
}

function map(r: Record<string, unknown>, today: string, soonLimit: string): InventoryItemRow {
  const qty = r.quantity as number;
  const min = r.min_quantity as number;
  const exp = (r.expiry_date as string) ?? null;
  return {
    id: r.id as number,
    sku: r.sku as string,
    name: r.name as string,
    category: (r.category as string) ?? '',
    supplier: (r.supplier as string) ?? '',
    unit: (r.unit as string) ?? 'pcs',
    cost: r.cost_paisa as number,
    price: r.price_paisa as number,
    quantity: qty,
    minQuantity: min,
    expiryDate: exp,
    batch: (r.batch as string) ?? '',
    active: !!r.active,
    notes: (r.notes as string) ?? '',
    lowStock: min > 0 && qty <= min,
    expiringSoon: exp != null && exp <= soonLimit
  };
}

const MOVEMENT_SIGNS: Record<InventoryMovementType, 1 | -1> = {
  purchase: 1,
  stock_in: 1,
  stock_out: -1,
  adjustment: 1, // qty carries its own sign for adjustment/return/correction
  return: 1,
  correction: 1
};

export class InventoryService {
  constructor(
    private db: Database.Database,
    private audit: AuditService,
    private timezone: () => string
  ) {}

  private today(): string {
    return todayLocal(this.timezone());
  }

  get(id: number): InventoryItemRow {
    const r = this.db.prepare('SELECT * FROM inventory_items WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!r) throw new AppError(ERR.NOT_FOUND, 'Inventory item not found.');
    return map(r, this.today(), addDays(this.today(), 30));
  }

  list(q: { search?: string; category?: string; lowStockOnly?: boolean; expiringOnly?: boolean; includeInactive?: boolean; page?: number; pageSize?: number }): Page<InventoryItemRow> {
    const where: string[] = [];
    const args: unknown[] = [];
    if (!q.includeInactive) where.push('active = 1');
    if (q.category) { where.push('category = ?'); args.push(q.category); }
    if (q.search?.trim()) {
      const like = `%${q.search.trim().replace(/[\\%_]/g, (m) => '\\' + m)}%`;
      where.push("(name LIKE ? ESCAPE '\\' COLLATE NOCASE OR sku LIKE ? ESCAPE '\\' COLLATE NOCASE OR supplier LIKE ? ESCAPE '\\')");
      args.push(like, like, like);
    }
    if (q.lowStockOnly) where.push('min_quantity > 0 AND quantity <= min_quantity');
    if (q.expiringOnly) { where.push('expiry_date IS NOT NULL AND expiry_date <= ?'); args.push(addDays(this.today(), 30)); }
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = (this.db.prepare(`SELECT COUNT(*) c FROM inventory_items ${w}`).get(...args) as { c: number }).c;
    const pageSize = Math.min(Math.max(q.pageSize ?? 50, 1), 500);
    const page = Math.max(q.page ?? 1, 1);
    const rows = this.db
      .prepare(`SELECT * FROM inventory_items ${w} ORDER BY name COLLATE NOCASE, id LIMIT ? OFFSET ?`)
      .all(...args, pageSize, (page - 1) * pageSize) as Record<string, unknown>[];
    const today = this.today();
    return { rows: rows.map((r) => map(r, today, addDays(today, 30))), total, page, pageSize };
  }

  createItem(actor: string, input: InventoryItemInput & { openingQuantity?: number }): InventoryItemRow {
    if (!input.sku?.trim()) throw new AppError(ERR.VALIDATION, 'SKU / item code is required.');
    if (!input.name?.trim()) throw new AppError(ERR.VALIDATION, 'Item name is required.');
    if (input.expiryDate && !isValidLocalDate(input.expiryDate)) throw new AppError(ERR.VALIDATION, 'Expiry date must be YYYY-MM-DD.');
    const cost = input.cost === undefined || input.cost === '' ? 0 : parsePositiveMoney(input.cost, 'cost');
    const price = input.price === undefined || input.price === '' ? 0 : parsePositiveMoney(input.price, 'price');
    const opening = input.openingQuantity ?? 0;
    if (!Number.isInteger(opening) || opening < 0) throw new AppError(ERR.VALIDATION, 'Opening quantity must be a non-negative integer.');
    const tx = this.db.transaction(() => {
      const now = nowUtc();
      const res = this.db
        .prepare(
          `INSERT INTO inventory_items (sku, name, category, supplier, unit, cost_paisa, price_paisa, quantity, min_quantity, expiry_date, batch, active, notes, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          input.sku.trim().toUpperCase(),
          input.name.trim(),
          input.category ?? '',
          input.supplier ?? '',
          input.unit ?? 'pcs',
          cost,
          price,
          0,
          input.minQuantity ?? 0,
          input.expiryDate || null,
          input.batch ?? '',
          (input.active ?? true) ? 1 : 0,
          input.notes ?? '',
          now,
          now
        );
      const id = Number(res.lastInsertRowid);
      if (opening > 0) {
        this.db.prepare('UPDATE inventory_items SET quantity = ? WHERE id = ?').run(opening, id);
        this.db
          .prepare(
            `INSERT INTO inventory_movements (item_id, type, qty, unit_cost_paisa, balance_after, reference, notes, created_by, created_at)
             VALUES (?, 'stock_in', ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(id, opening, cost, opening, 'OPENING', 'Opening stock', actor, now);
      }
      this.audit.record(actor, 'inventory.item.create', 'inventory_items', id, { sku: input.sku.trim().toUpperCase() });
      return id;
    });
    return this.get(tx.immediate());
  }

  updateItem(actor: string, id: number, patch: Partial<InventoryItemInput>): InventoryItemRow {
    const cur = this.get(id);
    if (patch.expiryDate && !isValidLocalDate(patch.expiryDate)) throw new AppError(ERR.VALIDATION, 'Expiry date must be YYYY-MM-DD.');
    const cost = patch.cost === undefined ? cur.cost : patch.cost === '' ? 0 : parsePositiveMoney(patch.cost, 'cost');
    const price = patch.price === undefined ? cur.price : patch.price === '' ? 0 : parsePositiveMoney(patch.price, 'price');
    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE inventory_items SET sku=?, name=?, category=?, supplier=?, unit=?, cost_paisa=?, price_paisa=?, min_quantity=?, expiry_date=?, batch=?, active=?, notes=?, updated_at=? WHERE id=?`
        )
        .run(
          (patch.sku ?? cur.sku).trim().toUpperCase(),
          (patch.name ?? cur.name).trim(),
          patch.category ?? cur.category,
          patch.supplier ?? cur.supplier,
          patch.unit ?? cur.unit,
          cost,
          price,
          patch.minQuantity ?? cur.minQuantity,
          patch.expiryDate !== undefined ? patch.expiryDate || null : cur.expiryDate,
          patch.batch ?? cur.batch,
          (patch.active ?? cur.active) ? 1 : 0,
          patch.notes ?? cur.notes,
          nowUtc(),
          id
        );
      this.audit.record(actor, 'inventory.item.update', 'inventory_items', id, {});
    });
    tx.immediate();
    return this.get(id);
  }

  /**
   * Record a stock movement and update the balance atomically. Negative stock
   * is rejected: the movement and balance change live or die together.
   */
  recordMovement(actor: string, input: { itemId: number; type: InventoryMovementType; qty: number; unitCost?: string | number; reference?: string; notes?: string }): MovementRow {
    const valid: InventoryMovementType[] = ['purchase', 'stock_in', 'stock_out', 'adjustment', 'return', 'correction'];
    if (!valid.includes(input.type)) throw new AppError(ERR.VALIDATION, 'Invalid movement type.');
    if (!Number.isInteger(input.qty) || input.qty === 0) throw new AppError(ERR.VALIDATION, 'Movement quantity must be a non-zero integer.');
    const directional = MOVEMENT_SIGNS[input.type];
    let signedQty: number;
    if (input.type === 'adjustment' || input.type === 'correction') {
      signedQty = input.qty; // explicit sign for corrections
    } else {
      if (input.qty < 0) throw new AppError(ERR.VALIDATION, 'Enter a positive quantity for this movement type.');
      signedQty = input.qty * directional;
    }
    const unitCost = input.unitCost === undefined || input.unitCost === '' ? 0 : parsePositiveMoney(input.unitCost, 'unit cost');
    const tx = this.db.transaction(() => {
      const item = this.db.prepare('SELECT * FROM inventory_items WHERE id = ?').get(input.itemId) as Record<string, unknown> | undefined;
      if (!item) throw new AppError(ERR.NOT_FOUND, 'Inventory item not found.');
      const balanceBefore = item.quantity as number;
      const balanceAfter = balanceBefore + signedQty;
      if (balanceAfter < 0) {
        throw new AppError(ERR.CONFLICT, `Insufficient stock: ${item.name} has ${balanceBefore} ${item.unit}, cannot remove ${Math.abs(signedQty)}.`);
      }
      const now = nowUtc();
      this.db.prepare('UPDATE inventory_items SET quantity = ?, updated_at = ? WHERE id = ?').run(balanceAfter, now, input.itemId);
      const res = this.db
        .prepare(
          `INSERT INTO inventory_movements (item_id, type, qty, unit_cost_paisa, balance_after, reference, notes, created_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(input.itemId, input.type, signedQty, unitCost, balanceAfter, input.reference ?? '', input.notes ?? '', actor, now);
      this.audit.record(actor, `inventory.${input.type}`, 'inventory_items', input.itemId, { qty: signedQty, balanceAfter });
      return Number(res.lastInsertRowid);
    });
    const id = tx.immediate();
    const r = this.db.prepare('SELECT * FROM inventory_movements WHERE id = ?').get(id) as Record<string, unknown>;
    return {
      id: r.id as number,
      itemId: r.item_id as number,
      type: r.type as InventoryMovementType,
      qty: r.qty as number,
      unitCost: r.unit_cost_paisa as number,
      balanceAfter: r.balance_after as number,
      reference: (r.reference as string) ?? '',
      notes: (r.notes as string) ?? '',
      createdBy: (r.created_by as string) ?? '',
      createdAt: r.created_at as string
    };
  }

  movementsFor(itemId: number, page = 1, pageSize = 50): Page<MovementRow> {
    const total = (this.db.prepare('SELECT COUNT(*) c FROM inventory_movements WHERE item_id = ?').get(itemId) as { c: number }).c;
    const rows = this.db
      .prepare('SELECT * FROM inventory_movements WHERE item_id = ? ORDER BY id DESC LIMIT ? OFFSET ?')
      .all(itemId, pageSize, (page - 1) * pageSize) as Record<string, unknown>[];
    return {
      rows: rows.map((r) => ({
        id: r.id as number,
        itemId: r.item_id as number,
        type: r.type as InventoryMovementType,
        qty: r.qty as number,
        unitCost: r.unit_cost_paisa as number,
        balanceAfter: r.balance_after as number,
        reference: (r.reference as string) ?? '',
        notes: (r.notes as string) ?? '',
        createdBy: (r.created_by as string) ?? '',
        createdAt: r.created_at as string
      })),
      total,
      page,
      pageSize
    };
  }
}
