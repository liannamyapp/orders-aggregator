import { describe, expect, it } from "vitest";
import { apiOrder, dailyTotals, postWebhook, setupTestApp } from "./helpers.js";

const ctx = setupTestApp();

const day = async (date: string, customerId = "c_1") => (await dailyTotals(ctx.app, customerId, date, date)).json()[0];

describe("daily-totals: скидки", () => {
  it("gross, discount, net и total = gross", async () => {
    await postWebhook(ctx.app, apiOrder({ amount: 1000, discountPercent: 10, amountPaid: 900 }));
    await postWebhook(ctx.app, apiOrder({ amount: 1500, discountPercent: 20.5, amountPaid: 1192.5 }));
    expect(await day("2026-02-10")).toEqual({ date: "2026-02-10", total: 2500, gross: 2500, discount: 407.5, net: 2092.5 });
  });

  it("заказ без полей скидки (старый формат API) — без скидки", async () => {
    await postWebhook(ctx.app, apiOrder({ amount: 700 }));
    expect(await day("2026-02-10")).toMatchObject({ gross: 700, discount: 0, net: 700 });
  });

  it("discountPercent строкой и amount строкой", async () => {
    const res = await postWebhook(ctx.app, apiOrder({ amount: "2609.00", discountPercent: "7", amountPaid: 2426.37 }));
    expect(res.statusCode).toBe(200);
    expect(await day("2026-02-10")).toMatchObject({ gross: 2609, discount: 182.63, net: 2426.37 });
  });

  it("копейки не теряются на float: сумма до копейки", async () => {
    // 671.46 * 100 = 67145.99999999999 — раньше Math.floor давал 67145
    await postWebhook(ctx.app, apiOrder({ amount: 722, discountPercent: 7, amountPaid: 671.46 }));
    await postWebhook(ctx.app, apiOrder({ amount: 1, discountPercent: 71, amountPaid: 0.29 }));
    await postWebhook(ctx.app, apiOrder({ amount: 1, discountPercent: 43, amountPaid: 0.57 }));
    expect(await day("2026-02-10")).toMatchObject({ gross: 724, net: 672.32, discount: 51.68 });
  });

  it("нет amountPaid, есть discountPercent — считаем сами", async () => {
    await postWebhook(ctx.app, apiOrder({ amount: 999, discountPercent: 15 }));
    expect(await day("2026-02-10")).toMatchObject({ gross: 999, net: 849.15, discount: 149.85 });
  });

  it("невалидная скидка — 400", async () => {
    expect((await postWebhook(ctx.app, apiOrder({ amount: 100, amountPaid: 150 }))).statusCode).toBe(400);
    expect((await postWebhook(ctx.app, apiOrder({ amount: 100, discountPercent: 120 }))).statusCode).toBe(400);
    expect((await postWebhook(ctx.app, apiOrder({ amount: 100, discountPercent: "abc" }))).statusCode).toBe(400);
  });

  it("вебхук с новой скидкой обновляет net", async () => {
    const o = apiOrder({ amount: 1000, discountPercent: 0, amountPaid: 1000 });
    await postWebhook(ctx.app, o);
    await postWebhook(ctx.app, { ...o, discountPercent: 33, amountPaid: 670, updatedAt: "2026-02-10T13:00:00Z" });
    expect(await day("2026-02-10")).toMatchObject({ gross: 1000, discount: 330, net: 670 });
  });

  it("pending и refunded не входят ни в gross, ни в net", async () => {
    await postWebhook(ctx.app, apiOrder({ amount: 500, discountPercent: 10, amountPaid: 450 }));
    await postWebhook(ctx.app, apiOrder({ amount: 700, discountPercent: 10, amountPaid: 630, status: "pending" }));
    await postWebhook(ctx.app, apiOrder({ amount: 900, discountPercent: 10, amountPaid: 810, status: "refunded" }));
    expect(await day("2026-02-10")).toMatchObject({ total: 500, gross: 500, discount: 50, net: 450 });
  });
});

describe("daily-totals: переход на летнее время (жалоба по c_7)", () => {
  // Europe/Berlin: до 2026-03-29 01:00Z — UTC+1, после — UTC+2.
  // Раньше смещение бралось на текущий момент (new Date()) и применялось ко всем дням,
  // поэтому заказы около полуночи попадали не в тот день с одной из сторон перехода.
  it("день заказа считается по смещению на момент заказа", async () => {
    ctx.api.customers.set("c_7", "Europe/Berlin");
    await postWebhook(ctx.app, apiOrder({ customerId: "c_7", amount: 100, createdAt: "2026-03-28T22:30:00Z" })); // 23:30 CET, 28-е
    await postWebhook(ctx.app, apiOrder({ customerId: "c_7", amount: 200, createdAt: "2026-03-28T23:30:00Z" })); // 00:30 CET, 29-е
    await postWebhook(ctx.app, apiOrder({ customerId: "c_7", amount: 400, createdAt: "2026-03-29T21:30:00Z" })); // 23:30 CEST, 29-е
    await postWebhook(ctx.app, apiOrder({ customerId: "c_7", amount: 800, createdAt: "2026-03-29T22:30:00Z" })); // 00:30 CEST, 30-е

    const res = await dailyTotals(ctx.app, "c_7", "2026-03-28", "2026-03-30");
    expect(res.json().map((d: { date: string; total: number }) => [d.date, d.total])).toEqual([
      ["2026-03-28", 100],
      ["2026-03-29", 600],
      ["2026-03-30", 800],
    ]);
  });

  it("осенний переход: America/New_York, 2026-11-01", async () => {
    ctx.api.customers.set("c_ny", "America/New_York");
    await postWebhook(ctx.app, apiOrder({ customerId: "c_ny", amount: 10, createdAt: "2026-11-01T03:30:00Z" })); // 23:30 EDT, 31.10
    await postWebhook(ctx.app, apiOrder({ customerId: "c_ny", amount: 20, createdAt: "2026-11-02T04:30:00Z" })); // 23:30 EST, 01.11
    await postWebhook(ctx.app, apiOrder({ customerId: "c_ny", amount: 40, createdAt: "2026-11-02T05:30:00Z" })); // 00:30 EST, 02.11

    const res = await dailyTotals(ctx.app, "c_ny", "2026-10-31", "2026-11-02");
    expect(res.json().map((d: { total: number }) => d.total)).toEqual([10, 20, 40]);
  });
});
