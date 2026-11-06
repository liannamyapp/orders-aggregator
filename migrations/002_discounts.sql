-- Скидки из внешнего API (discountPercent, amountPaid).
--
-- Для уже сохранённых заказов скидка неизвестна: оставляем NULL.
-- NULL означает «версия сохранена до появления скидок»: в статистике такой заказ
-- считается без скидки (net = gross), а ближайший POST /sync перезапишет его,
-- даже если updatedAt не изменился (см. OrdersRepository.upsertIfNewer).
ALTER TABLE orders
  ADD COLUMN discount_percent NUMERIC(5, 2),
  ADD COLUMN amount_paid_kop  BIGINT;

ALTER TABLE orders
  ADD CONSTRAINT orders_discount_percent_range CHECK (discount_percent BETWEEN 0 AND 100),
  ADD CONSTRAINT orders_amount_paid_range CHECK (amount_paid_kop BETWEEN 0 AND amount_kop);
