import { describe, expect, it } from "vitest";
import { fromKop, parsePercent, parseRub, toKop } from "../src/utils/money.js";

describe("parseRub", () => {
  it("принимает число и строку с числом", () => {
    expect(parseRub(2500)).toBe(2500);
    expect(parseRub("2500.00")).toBe(2500);
    expect(parseRub(" 99 ")).toBe(99);
  });

  it("отклоняет мусор и отрицательные суммы", () => {
    expect(() => parseRub("abc")).toThrow();
    expect(() => parseRub(null)).toThrow();
    expect(() => parseRub(-1)).toThrow();
  });
});

describe("toKop / fromKop", () => {
  it("рубли в копейки", () => {
    expect(toKop(2500)).toBe(250000);
    expect(toKop(99)).toBe(9900);
  });

  it("отбрасывает доли копейки", () => {
    expect(toKop(10.999)).toBe(1099);
  });

  it("копейки в рубли", () => {
    expect(fromKop(250000)).toBe(2500);
    expect(fromKop(1099)).toBe(10.99);
  });
});

describe("toKop: погрешность float", () => {
  it("не теряет копейку на суммах, непредставимых в двоичном виде", () => {
    expect(toKop(671.46)).toBe(67146); // 671.46 * 100 = 67145.99999999999
    expect(toKop(0.29)).toBe(29);
    expect(toKop(0.57)).toBe(57);
    expect(toKop(1192.5)).toBe(119250);
  });

  it("настоящие доли копейки по-прежнему отбрасывает", () => {
    expect(toKop(1.005)).toBe(100);
    expect(toKop(10.999)).toBe(1099);
  });
});

describe("parsePercent", () => {
  it("число и строка", () => {
    expect(parsePercent(7)).toBe(7);
    expect(parsePercent("7")).toBe(7);
    expect(parsePercent("20.5")).toBe(20.5);
  });

  it("вне 0..100 и мусор — ошибка", () => {
    expect(() => parsePercent(-1)).toThrow();
    expect(() => parsePercent(101)).toThrow();
    expect(() => parsePercent("")).toThrow();
    expect(() => parsePercent("abc")).toThrow();
  });
});
