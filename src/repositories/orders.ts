import type { Db } from "../db.js";

export interface Order {
  id: string;
  customerId: string;
  /** Сумма до скидки, копейки. */
  amountKop: number;
  /** Скидка, %. null — версия сохранена до появления скидок в API (см. миграцию 002). */
  discountPercent: number | null;
  /** Фактически оплачено, копейки. null — см. discountPercent. */
  amountPaidKop: number | null;
  status: "pending" | "paid" | "refunded";
  createdAt: Date;
  updatedAt: Date;
}

/** Версия заказа из внешнего API: скидка всегда известна. */
export type IncomingOrder = Order & { discountPercent: number; amountPaidKop: number };

export type UpsertResult = "created" | "updated" | "stale";

interface Row {
  id: string;
  customer_id: string;
  amount_kop: string;
  discount_percent: string | null;
  amount_paid_kop: string | null;
  status: Order["status"];
  created_at: Date;
  updated_at: Date;
}

const fromRow = (r: Row): Order => ({
  id: r.id,
  customerId: r.customer_id,
  amountKop: Number(r.amount_kop),
  discountPercent: r.discount_percent === null ? null : Number(r.discount_percent),
  amountPaidKop: r.amount_paid_kop === null ? null : Number(r.amount_paid_kop),
  status: r.status,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export class OrdersRepository {
  constructor(private readonly db: Db) {}

  async get(id: string): Promise<Order | null> {
    const { rows } = await this.db.query<Row>(`SELECT * FROM orders WHERE id = $1`, [id]);
    return rows[0] ? fromRow(rows[0]) : null;
  }

  /**
   * Сохраняет версию заказа, только если она новее сохранённой (по updatedAt).
   * Проверка и запись — один атомарный запрос: вебхуки одного заказа приходят параллельно,
   * и при «прочитать → сравнить → записать» старая версия могла перезаписать новую.
   *
   * Версию с тем же updatedAt принимаем только поверх строки без скидки (сохранена до миграции 002):
   * так повторный /sync дозаполняет скидки, а дубли вебхуков остаются «stale».
   */
  async upsertIfNewer(o: IncomingOrder): Promise<UpsertResult> {
    const { rows } = await this.db.query<{ inserted: boolean }>(
      `INSERT INTO orders (id, customer_id, amount_kop, discount_percent, amount_paid_kop, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO UPDATE SET
         customer_id      = excluded.customer_id,
         amount_kop       = excluded.amount_kop,
         discount_percent = excluded.discount_percent,
         amount_paid_kop  = excluded.amount_paid_kop,
         status           = excluded.status,
         created_at       = excluded.created_at,
         updated_at       = excluded.updated_at
       WHERE orders.updated_at < excluded.updated_at
          OR (orders.updated_at = excluded.updated_at AND orders.amount_paid_kop IS NULL)
       RETURNING (xmax = 0) AS inserted`,
      [o.id, o.customerId, o.amountKop, o.discountPercent, o.amountPaidKop, o.status, o.createdAt, o.updatedAt],
    );
    if (rows.length === 0) return "stale";
    return rows[0].inserted ? "created" : "updated";
  }

  /** Оплаченные заказы клиента, созданные в [from, to). */
  async paidCreatedBetween(customerId: string, from: Date, to: Date): Promise<Order[]> {
    const { rows } = await this.db.query<Row>(
      `SELECT * FROM orders
        WHERE customer_id = $1 AND status = 'paid' AND created_at >= $2 AND created_at < $3`,
      [customerId, from, to],
    );
    return rows.map(fromRow);
  }
}
