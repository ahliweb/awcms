-- Telegram delivery: proof of possession for a chat binding (Issue #1008, M5 of
-- the #965 security audit, ADR-0140 section 3 amendment).
--
-- ## What this closes
--
-- Until now the staff member confirmed a pending binding by pressing a button
-- beside an attacker-influenced display name. A forwarded or phished link code
-- therefore turned into an active binding of the attacker's chat the moment the
-- victim recognised the name (or did not look). The bot now answers `/start`
-- with a short PIN, and the confirmation must carry it: the person has to type
-- into the admin something that only the HOLDER of the chat saw.
--
-- ## What is stored
--
-- Only a keyed hash of the PIN (`<keyId>:<hex>`, the chat-hash key ring, bound to
-- the tenant and the binding id), never the PIN itself, exactly as the link code
-- is stored only as a hash. A six-digit PIN is guessable offline from a leaked
-- hash, which is why it is also short-lived (it lives only as long as the pending
-- window) and why the number of WRONG answers is counted in the database:
-- `pin_attempts` is incremented in the same statement that finds the answer
-- wrong, so the bound does not depend on Redis, on the rate limiter or on any
-- in-process state.
--
-- A row left pending by the code that ran before this migration has no PIN
-- (`pin_hash IS NULL`) and can therefore never be confirmed: it fails closed and
-- expires within the ten-minute window, and the person requests a new link.

ALTER TABLE awcms_telegram_bindings
  ADD COLUMN IF NOT EXISTS pin_hash text,
  ADD COLUMN IF NOT EXISTS pin_attempts smallint NOT NULL DEFAULT 0;

-- A PIN exists only while the binding waits for confirmation. Every way out of
-- `pending_confirmation` (confirm, reject, expiry, revoke) nulls it in the same
-- statement. The erasure sentinel is the one other value subject-data erasure
-- writes (ADR-0094) and it writes it to every row of the subject whatever its
-- status, so the CHECK admits it everywhere; it is never a real hash.
ALTER TABLE awcms_telegram_bindings
  ADD CONSTRAINT awcms_telegram_bindings_pin_hash_check
    CHECK (pin_hash IS NULL
           OR pin_hash LIKE '[erased]%'
           OR (status = 'pending_confirmation'
               AND char_length(pin_hash) <= 200)),
  ADD CONSTRAINT awcms_telegram_bindings_pin_attempts_check
    CHECK (pin_attempts BETWEEN 0 AND 20);

-- The worker (dispatcher and purge) ends bindings, which must clear the PIN, so
-- it needs UPDATE on this one column; the trigger below keeps that to NULLing.
GRANT UPDATE (pin_hash) ON awcms_telegram_bindings TO awcms_worker;

-- Only the authenticated application role (the webhook that creates the pending
-- row, and the confirm route that counts a wrong answer) may set a PIN hash or
-- change the attempt counter upwards. Any other role may only CLEAR the hash and
-- may never lower the counter, so a compromised job cannot plant a PIN it knows
-- or hand a pending binding fresh attempts. The table owner (migrations,
-- fixtures) is exempt, as in `awcms_telegram_bindings_activation_guard`.
CREATE OR REPLACE FUNCTION awcms_telegram_bindings_pin_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
DECLARE
  table_owner text;
BEGIN
  SELECT pg_get_userbyid(c.relowner) INTO table_owner
  FROM pg_class AS c WHERE c.oid = TG_RELID;

  IF current_user = table_owner OR current_user = 'awcms_app' THEN
    RETURN NEW;
  END IF;

  IF NEW.pin_hash IS NOT NULL
     AND NEW.pin_hash NOT LIKE '[erased]%'
     AND NEW.pin_hash IS DISTINCT FROM OLD.pin_hash THEN
    RAISE EXCEPTION 'only the authenticated application role may write a Telegram verification PIN hash'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.pin_attempts < OLD.pin_attempts THEN
    RAISE EXCEPTION 'only the authenticated application role may reset Telegram PIN attempts'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE TRIGGER awcms_telegram_bindings_pin_guard
  BEFORE UPDATE OF pin_hash, pin_attempts ON awcms_telegram_bindings
  FOR EACH ROW
  EXECUTE FUNCTION awcms_telegram_bindings_pin_guard();
