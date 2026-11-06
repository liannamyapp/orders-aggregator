import { describe, expect, it } from "vitest";
import { apiOrder, postWebhook, setupTestApp } from "./helpers.js";

const ctx = setupTestApp();

describe("параллельные вебхуки и пересинхронизация", () => {
  it("при параллельной доставке побеждает самая новая версия", async () => {
    // Внешний API шлёт дубли и разные версии одного заказа одновременно (в одну миллисекунду).
    // Раньше apply() делал «прочитать → сравнить → записать», и старая версия могла затереть новую.
    for (let round = 0; round < 20; round++) {
      const base = apiOrder({ amount: 1000, discountPercent: 0, amountPaid: 1000, updatedAt: "2026-02-10T12:00:00Z" });
      const v2 = { ...base, discountPercent: 10, amountPaid: 900, updatedAt: "2026-02-10T13:00:00Z" };
      const v3 = { ...base, discountPercent: 33, amountPaid: 670, status: "refunded", updatedAt: "2026-02-10T14:00:00Z" };
      const deliveries = [v3, base, v2, base, v3, v2, base, v2];

      const results = (await Promise.all(deliveries.map((o) => postWebhook(ctx.app, o)))).map((r) => r.json().result);
      expect(results.filter((r) => r === "created")).toHaveLength(1);

      const { rows } = await ctx.db.query(`SELECT status, amount_paid_kop, updated_at FROM orders WHERE id = $1`, [base.id]);
      expect(rows[0]).toMatchObject({ status: "refunded", amount_paid_kop: "67000" });
      expect(rows[0].updated_at.toISOString()).toBe("2026-02-10T14:00:00.000Z");
    }
  });

  it("строки, сохранённые до миграции скидок, дозаполняются синком с тем же updatedAt", async () => {
    const o = apiOrder({ amount: 1000, discountPercent: 10, amountPaid: 900 });
    await ctx.db.query(
      `INSERT INTO orders (id, customer_id, amount_kop, status, created_at, updated_at) VALUES ($1, $2, 100000, 'paid', $3, $4)`,
      [o.id, o.customerId, o.createdAt, o.updatedAt],
    );
    ctx.api.pages.set(null, { items: [o], nextCursor: null });

    const res = await ctx.app.inject({ method: "POST", url: "/sync" });
    expect(res.json()).toMatchObject({ applied: 1, stale: 0 });
    const { rows } = await ctx.db.query(`SELECT amount_paid_kop, discount_percent FROM orders WHERE id = $1`, [o.id]);
    expect(rows[0]).toEqual({ amount_paid_kop: "90000", discount_percent: "10.00" });

    // Повторный синк той же версии — уже stale
    expect((await ctx.app.inject({ method: "POST", url: "/sync" })).json()).toMatchObject({ applied: 0, stale: 1 });
  });
});
