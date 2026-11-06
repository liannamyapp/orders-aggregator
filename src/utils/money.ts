/**
 * Деньги внутри сервиса — целые копейки. Рубли — только на входе (внешний API) и в ответах.
 */

/** Сумма из внешнего API: число или строка с числом ("250.10"). */
export function parseRub(raw: unknown): number {
  const value = typeof raw === "string" ? Number(raw.trim()) : raw;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`invalid amount: ${JSON.stringify(raw)}`);
  }
  return value;
}

/** Процент скидки из внешнего API: число или строка с числом ("7"), от 0 до 100. */
export function parsePercent(raw: unknown): number {
  const value = typeof raw === "string" && raw.trim() !== "" ? Number(raw.trim()) : raw;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error(`invalid discountPercent: ${JSON.stringify(raw)}`);
  }
  return value;
}

/** Погрешность двоичной арифметики: 671.46 * 100 = 67145.99999999999. */
const FLOAT_EPSILON = 1e-6;

/**
 * Рубли → копейки. Доли копейки отбрасываются: деньги клиенту не досчитываем.
 * Но сначала гасим погрешность float: иначе 671.46 ₽ превращаются в 67145 коп. вместо 67146.
 */
export function toKop(rub: number): number {
  const kop = rub * 100;
  const rounded = Math.round(kop);
  return Math.abs(kop - rounded) < FLOAT_EPSILON ? rounded : Math.floor(kop);
}

/** Копейки → рубли для ответа API. */
export function fromKop(kop: number): number {
  return kop / 100;
}
