import { z } from "zod";
import { ValidationError } from "../errors.js";
import type { IncomingOrder, OrdersRepository, UpsertResult } from "../repositories/orders.js";
import { parsePercent, parseRub, toKop } from "../utils/money.js";
import { parseUtc } from "../utils/time.js";

const NumberLike = z.union([z.number(), z.string()]);

/** Заказ в формате внешнего API (поля, которые нам нужны; остальные игнорируем). */
const ExternalOrder = z.object({
  id: z.string().min(1),
  customerId: z.string().min(1),
  amount: NumberLike,
  // Поля скидки появились недавно: в старых заказах их нет; discountPercent бывает строкой ("7")
  discountPercent: NumberLike.nullish(),
  amountPaid: NumberLike.nullish(),
  status: z.enum(["pending", "paid", "refunded"]),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type ApplyResult = UpsertResult;

export class OrdersService {
  constructor(private readonly orders: OrdersRepository) {}

  normalize(raw: unknown): IncomingOrder {
    const parsed = ExternalOrder.safeParse(raw);
    if (!parsed.success) throw new ValidationError(`invalid order: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}`);
    const o = parsed.data;
    try {
      const amountKop = toKop(parseRub(o.amount));
      const { discountPercent, amountPaidKop } = discountOf(amountKop, o.discountPercent, o.amountPaid);
      return {
        id: o.id,
        customerId: o.customerId,
        amountKop,
        discountPercent,
        amountPaidKop,
        status: o.status,
        createdAt: parseUtc(o.createdAt),
        updatedAt: parseUtc(o.updatedAt),
      };
    } catch (e) {
      throw new ValidationError((e as Error).message);
    }
  }

  /**
   * Применяет версию заказа (из синка или вебхука).
   * Вебхуки приходят с повторами, не по порядку и параллельно, поэтому версию сохраняем,
   * только если она новее уже сохранённой (по updatedAt) — атомарно, в одном запросе.
   */
  async apply(raw: unknown): Promise<ApplyResult> {
    return this.orders.upsertIfNewer(this.normalize(raw));
  }
}

/**
 * Скидка заказа. Источник истины для «сколько заплатили» — amountPaid.
 * - нет ни amountPaid, ни discountPercent (заказы до появления скидок) — скидки нет;
 * - нет amountPaid, есть discountPercent — считаем сами, доли копейки отбрасываем, как в toKop;
 * - нет discountPercent, есть amountPaid — процент выводим из сумм.
 */
function discountOf(
  amountKop: number,
  rawPercent: string | number | null | undefined,
  rawPaid: string | number | null | undefined,
): { discountPercent: number; amountPaidKop: number } {
  const hasPercent = rawPercent !== undefined && rawPercent !== null;
  const hasPaid = rawPaid !== undefined && rawPaid !== null;
  const percent = hasPercent ? parsePercent(rawPercent) : null;

  let paidKop: number;
  if (hasPaid) paidKop = toKop(parseRub(rawPaid));
  else if (percent !== null) paidKop = Math.floor((amountKop * (100 - percent)) / 100);
  else paidKop = amountKop;

  if (paidKop > amountKop) {
    throw new Error(`amountPaid (${paidKop / 100}) exceeds amount (${amountKop / 100})`);
  }
  const derived = amountKop === 0 ? 0 : Math.round(((amountKop - paidKop) / amountKop) * 10_000) / 100;
  return { discountPercent: percent ?? derived, amountPaidKop: paidKop };
}
