-- PayPal capture may legitimately be pending at the provider. Keep this
-- state durable rather than failing the whole tenant transaction on the status check.
ALTER TABLE public.paypilot_paypal_order_routes
  DROP CONSTRAINT IF EXISTS paypilot_paypal_order_routes_status_check;
ALTER TABLE public.paypilot_paypal_order_routes
  ADD CONSTRAINT paypilot_paypal_order_routes_status_check
  CHECK (status = ANY (ARRAY['created','pending','captured','failed','cancelled']));
