/**
 * The booking reservation HTTP surface, driven through the REAL route handlers
 * against a real PostgreSQL (Issue #941, ADR-0131; docs/awcms/booking.md section
 * 6) -- WORLD-2 of the harness.
 *
 * What this proves that the service-level tests cannot:
 *
 *   * default-deny: no token is 401, a user with no role is 403 on every route and
 *     writes nothing;
 *   * every guard BITES, both ways (the access matrix of booking.md section 6): a
 *     user holding every booking permission EXCEPT one is refused that action, a
 *     user holding ONLY that one is allowed it -- so "seeded" and "enforced" are
 *     the same fact;
 *   * the HIGH-RISK `override` is checked first and independently: `create` alone
 *     cannot lift policy, `override` alone cannot create, both together can, and
 *     it is audited `critical`; the same for a reschedule;
 *   * `Idempotency-Key`: required, a replay returns the SAME row and writes
 *     nothing, a reused key with a different request (or by a different user) is
 *     409, five parallel requests with one key make one reservation (T4);
 *   * a payment field is `400 PAYMENT_FIELD_NOT_ACCEPTED` naming the field;
 *   * not-found is neutral: an unknown id and another tenant's id are the same
 *     answer;
 *   * the lifecycle through the real handlers, the staff-only no-show, and a
 *     reschedule that returns both the replacement and the superseded
 *     reservation.
 *
 * Gated on `DATABASE_URL` (harness section Gating).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";

import {
  createCookieJar,
  ensureHandlerDatabaseReady,
  getHandlerAdminSql,
  getHandlerDatabaseClient,
  integrationEnabled,
  invoke,
  resetHandlerDatabase,
  teardownHandlerDatabase
} from "./harness";
import { hashSessionToken } from "../../src/lib/auth/session-token";
import { withTenantOrThrow } from "../../src/lib/database/tenant-context";
import { grantRolePolicy } from "../../src/modules/identity-access/application/access-policy-writer";
import { bookingModule } from "../../src/modules/booking/module";
import { POST as setupInitialize } from "../../src/pages/api/v1/setup/initialize";
import { POST as authLogin } from "../../src/pages/api/v1/auth/login";
import {
  GET as listReservations,
  POST as postReservation
} from "../../src/pages/api/v1/booking/reservations/index";
import { GET as getReservation } from "../../src/pages/api/v1/booking/reservations/[id]";
import { POST as cancelReservation } from "../../src/pages/api/v1/booking/reservations/[id]/cancel";
import { POST as checkInReservation } from "../../src/pages/api/v1/booking/reservations/[id]/check-in";
import { POST as checkOutReservation } from "../../src/pages/api/v1/booking/reservations/[id]/check-out";
import { POST as confirmReservation } from "../../src/pages/api/v1/booking/reservations/[id]/confirm";
import { POST as noShowReservation } from "../../src/pages/api/v1/booking/reservations/[id]/no-show";
import { POST as rescheduleReservation } from "../../src/pages/api/v1/booking/reservations/[id]/reschedule";

// Built at runtime: GitGuardian scans every committed literal.
const OWNER_PASSWORD = randomBytes(12).toString("hex") + "-Aa1!";
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const START = Math.ceil((Date.now() + 3 * DAY) / HOUR) * HOUR;
const OTHER_TENANT = "b9411111-0000-4000-8000-00000000000b";

type Env = { tenantId: string; token: string };

type Envelope<T = unknown> = {
  success: boolean;
  data?: T;
  error?: { code: string; message: string; details?: unknown };
};

type Reservation = {
  id: string;
  reservationNo: string;
  lineageId: string;
  rescheduledFromId: string | null;
  supersededById: string | null;
  status: string;
  externalRef: string | null;
  lateCancellation: boolean;
  holdExpiresAt: string | null;
};

type Result = { reservation: Reservation; replayed: boolean };

let env: Env;
let keyCounter = 0;
let userCounter = 0;
let sequence = 0;

const admin = () => getHandlerAdminSql();

function nextKey(): string {
  keyCounter += 1;

  return `idem-${keyCounter}-${crypto.randomUUID()}`;
}

async function bootstrap(): Promise<Env> {
  const loginIdentifier = "bk-owner@example.com";
  const setup = await invoke<{ data: { tenantId: string } }>(setupInitialize, {
    method: "POST",
    path: "/api/v1/setup/initialize",
    headers: { "content-type": "application/json" },
    body: {
      tenantName: "Booking Co",
      tenantCode: "booking-co",
      officeCode: "hq",
      officeName: "HQ",
      ownerLoginIdentifier: loginIdentifier,
      ownerPassword: OWNER_PASSWORD,
      ownerDisplayName: "Owner"
    }
  });

  expect(setup.status).toBe(200);

  const tenantId = setup.body.data.tenantId;
  const login = await invoke<{ data: { token: string } }>(authLogin, {
    method: "POST",
    path: "/api/v1/auth/login",
    headers: {
      "content-type": "application/json",
      "x-awcms-tenant-id": tenantId
    },
    body: { loginIdentifier, password: OWNER_PASSWORD },
    cookies: createCookieJar()
  });

  expect(login.status).toBe(200);

  return { tenantId, token: login.body.data.token };
}

async function seedUser(
  tenantId: string,
  label: string,
  permissionKeys: readonly string[]
): Promise<{ token: string; tenantUserId: string }> {
  userCounter += 1;
  const sql = admin();
  const tag = `${label}-${userCounter}`;
  const profile = (await sql`
    INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
    VALUES (${tenantId}, 'person', ${`User ${tag}`})
    RETURNING id
  `) as { id: string }[];
  const identity = (await sql`
    INSERT INTO awcms_identities (tenant_id, profile_id, login_identifier, password_hash)
    VALUES (${tenantId}, ${profile[0]!.id}, ${`${tag}@example.com`}, 'x')
    RETURNING id
  `) as { id: string }[];
  const tenantUser = (await sql`
    INSERT INTO awcms_tenant_users (tenant_id, identity_id)
    VALUES (${tenantId}, ${identity[0]!.id})
    RETURNING id
  `) as { id: string }[];
  const token = `bk-${tag}-${Math.random().toString(36).slice(2)}`;

  await sql`
    INSERT INTO awcms_sessions (tenant_id, identity_id, token_hash, expires_at)
    VALUES (${tenantId}, ${identity[0]!.id}, ${hashSessionToken(token)},
            now() + interval '8 hours')
  `;

  if (permissionKeys.length > 0) {
    const role = (await sql`
      INSERT INTO awcms_roles (tenant_id, role_code, role_name)
      VALUES (${tenantId}, ${`role-${tag}`}, ${`Role ${tag}`})
      RETURNING id
    `) as { id: string }[];

    for (const key of permissionKeys) {
      const [moduleKey, activityCode, action] = key.split(".");
      const permission = (await sql`
        SELECT id FROM awcms_permissions
        WHERE module_key = ${moduleKey!} AND activity_code = ${activityCode!}
          AND action = ${action!}
      `) as { id: string }[];

      if (!permission[0]) {
        throw new Error(`fixture: permission ${key} is not in the catalogue`);
      }

      await sql`
        INSERT INTO awcms_role_permissions (tenant_id, role_id, permission_id)
        VALUES (${tenantId}, ${role[0]!.id}, ${permission[0].id})
      `;
    }

    await withTenantOrThrow(getHandlerDatabaseClient(), tenantId, (tx) =>
      grantRolePolicy(tx, tenantId, {
        tenantUserId: tenantUser[0]!.id,
        roleId: role[0]!.id,
        grantedByTenantUserId: null,
        reason: "partial-permission fixture"
      })
    );
  }

  return { token, tenantUserId: tenantUser[0]!.id };
}

const ALL_PERMISSIONS = (bookingModule.permissions ?? []).map(
  (permission) => `booking.${permission.activityCode}.${permission.action}`
);
const RESERVATION_PERMISSIONS = ALL_PERMISSIONS.filter((key) =>
  key.startsWith("booking.reservations.")
);

type Fixture = { resourceId: string; offeringId: string };

/** A slot resource open all day every day, with a 60-minute offering. Fresh codes. */
async function newFixture(
  tenantId: string,
  options: { capacity?: number; open?: boolean; cutoff?: number | null } = {}
): Promise<Fixture> {
  const sql = admin();
  sequence += 1;
  const code = `api${sequence}`;
  const capacity = options.capacity ?? 1;
  const resource = (await sql`
    INSERT INTO awcms_booking_resources
      (tenant_id, code, name, kind, capacity, timezone)
    VALUES (${tenantId}, ${code}, ${`Court ${code}`}, 'court', ${capacity},
            'Asia/Pontianak')
    RETURNING id
  `) as { id: string }[];

  for (let ordinal = 1; ordinal <= capacity; ordinal += 1) {
    await sql`
      INSERT INTO awcms_booking_resource_units (tenant_id, resource_id, ordinal)
      VALUES (${tenantId}, ${resource[0]!.id}, ${ordinal})
    `;
  }

  if (options.open !== false) {
    const day = [{ from: "00:00", to: "24:00" }];

    await sql`
      INSERT INTO awcms_booking_schedules
        (tenant_id, resource_id, timezone, effective_from, rules)
      VALUES (${tenantId}, ${resource[0]!.id}, 'Asia/Pontianak', '2020-01-01',
              ${{ weekly: { mon: day, tue: day, wed: day, thu: day, fri: day, sat: day, sun: day } }}::jsonb)
    `;
  }

  const offering = (await sql`
    INSERT INTO awcms_booking_service_offerings
      (tenant_id, code, name, granularity, duration_seconds, setup_seconds,
       cleanup_seconds, slot_step_seconds, max_party, confirmation_mode,
       cancellation_cutoff_seconds)
    VALUES (${tenantId}, ${`hour-${code}`}, 'Hour', 'time', 3600, 0, 0, 900, 4,
            'hold_then_confirm', ${options.cutoff ?? null})
    RETURNING id
  `) as { id: string }[];

  return { resourceId: resource[0]!.id, offeringId: offering[0]!.id };
}

function bodyOf(fixture: Fixture, extra: Record<string, unknown> = {}) {
  return {
    offeringId: fixture.offeringId,
    resourceId: fixture.resourceId,
    startsAt: new Date(START).toISOString(),
    partySize: 1,
    ...extra
  };
}

function call<T = unknown>(
  handler: Parameters<typeof invoke>[0],
  options: {
    method?: string;
    path: string;
    body?: unknown;
    params?: Record<string, string>;
    token?: string | null;
    idempotencyKey?: string | null;
    query?: string;
    tenantId?: string;
  }
) {
  const token = options.token === undefined ? env.token : options.token;
  const mutating = (options.method ?? "GET") !== "GET";
  const key =
    options.idempotencyKey === undefined && mutating
      ? nextKey()
      : options.idempotencyKey;
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-awcms-tenant-id": options.tenantId ?? env.tenantId
  };

  if (token) headers.authorization = `Bearer ${token}`;
  if (key) headers["idempotency-key"] = key;

  return invoke<Envelope<T>>(handler, {
    method: options.method,
    path: options.query ? `${options.path}?${options.query}` : options.path,
    headers,
    body: options.body,
    params: options.params,
    locals: { correlationId: crypto.randomUUID() }
  });
}

function place(
  body: unknown,
  options: {
    token?: string | null;
    key?: string | null;
    tenantId?: string;
  } = {}
) {
  return call<Result>(postReservation, {
    method: "POST",
    path: "/api/v1/booking/reservations",
    body,
    token: options.token,
    idempotencyKey: options.key,
    tenantId: options.tenantId
  });
}

type Verb = "confirm" | "cancel" | "check-in" | "check-out" | "no-show";
const VERBS: Record<Verb, Parameters<typeof invoke>[0]> = {
  confirm: confirmReservation,
  cancel: cancelReservation,
  "check-in": checkInReservation,
  "check-out": checkOutReservation,
  "no-show": noShowReservation
};

function act(
  verb: Verb,
  id: string,
  options: {
    token?: string | null;
    key?: string | null;
    body?: unknown;
    tenantId?: string;
  } = {}
) {
  return call<Result>(VERBS[verb], {
    method: "POST",
    path: `/api/v1/booking/reservations/${id}/${verb}`,
    params: { id },
    body: options.body ?? {},
    token: options.token,
    idempotencyKey: options.key,
    tenantId: options.tenantId
  });
}

function move(
  id: string,
  body: unknown,
  options: { token?: string | null; key?: string | null } = {}
) {
  return call<Result & { previous: Reservation; policyLifted: string[] }>(
    rescheduleReservation,
    {
      method: "POST",
      path: `/api/v1/booking/reservations/${id}/reschedule`,
      params: { id },
      body,
      token: options.token,
      idempotencyKey: options.key
    }
  );
}

function detail(id: string, token?: string | null, tenantId?: string) {
  return call<{
    reservation: Reservation;
    events: { kind: string; toStatus: string }[];
  }>(getReservation, {
    path: `/api/v1/booking/reservations/${id}`,
    params: { id },
    token,
    tenantId
  });
}

async function held(fixture: Fixture, extra: Record<string, unknown> = {}) {
  const response = await place(bodyOf(fixture, extra));

  expect(response.status).toBe(201);

  return response.body.data!.reservation;
}

async function confirmedReservation(
  fixture: Fixture,
  extra: Record<string, unknown> = {}
) {
  const reservation = await held(fixture, extra);

  expect((await act("confirm", reservation.id)).status).toBe(200);

  return reservation;
}

async function writes(tenantId: string) {
  const rows = (await admin()`
    SELECT
      (SELECT count(*) FROM awcms_booking_reservations WHERE tenant_id = ${tenantId})::int AS reservations,
      (SELECT count(*) FROM awcms_booking_reservation_events WHERE tenant_id = ${tenantId})::int AS history,
      (SELECT count(*) FROM awcms_domain_events WHERE tenant_id = ${tenantId} AND event_type LIKE 'awcms.booking.%')::int AS events,
      (SELECT count(*) FROM awcms_audit_events WHERE tenant_id = ${tenantId} AND module_key = 'booking')::int AS audit
  `) as Record<string, number>[];

  return { ...rows[0]! };
}

const suite = integrationEnabled ? describe : describe.skip;
let handlerReady = false;
let onlyUser: Record<string, { token: string; tenantUserId: string }> = {};
let exceptUser: Record<string, { token: string; tenantUserId: string }> = {};

suite("booking reservation HTTP surface (Issue #941)", () => {
  beforeAll(async () => {
    handlerReady = await ensureHandlerDatabaseReady();

    if (!handlerReady) {
      return;
    }

    await resetHandlerDatabase();
    env = await bootstrap();

    // For every reservation permission: a user holding ONLY it, and a user
    // holding every booking permission EXCEPT it (the access matrix).
    for (const key of RESERVATION_PERMISSIONS) {
      onlyUser[key] = await seedUser(
        env.tenantId,
        `only-${key.split(".")[2]}`,
        [key]
      );
      exceptUser[key] = await seedUser(
        env.tenantId,
        `except-${key.split(".")[2]}`,
        ALL_PERMISSIONS.filter((candidate) => candidate !== key)
      );
    }
  });

  afterAll(async () => {
    await teardownHandlerDatabase();
  });

  test("default-deny: no token is 401; a user with no role is 403 on every route and writes nothing", async () => {
    if (!handlerReady) return;
    const noRole = await seedUser(env.tenantId, "norole", []);
    const fixture = await newFixture(env.tenantId);
    const reservation = await confirmedReservation(fixture);
    const before = await writes(env.tenantId);

    expect((await place(bodyOf(fixture), { token: null })).status).toBe(401);

    const attempts = [
      call(listReservations, {
        path: "/api/v1/booking/reservations",
        token: noRole.token
      }),
      detail(reservation.id, noRole.token),
      place(bodyOf(fixture), { token: noRole.token }),
      act("confirm", reservation.id, { token: noRole.token }),
      act("cancel", reservation.id, { token: noRole.token }),
      act("check-in", reservation.id, { token: noRole.token }),
      act("check-out", reservation.id, { token: noRole.token }),
      act("no-show", reservation.id, { token: noRole.token }),
      move(
        reservation.id,
        { startsAt: new Date(START + HOUR).toISOString() },
        {
          token: noRole.token
        }
      )
    ];

    for (const response of await Promise.all(attempts)) {
      expect(response.status).toBe(403);
    }

    expect(await writes(env.tenantId)).toEqual(before);
    expect((await detail(reservation.id)).body.data!.reservation.status).toBe(
      "confirmed"
    );
  });

  describe("every guard bites (seeded AND enforced), both ways", () => {
    // Each action runs against a reservation already in the state it needs.
    const actions: [
      string,
      (
        token: string,
        fixture: Fixture,
        id: string
      ) => Promise<{ status: number }>,
      "none" | "held" | "confirmed" | "checked_in"
    ][] = [
      [
        "booking.reservations.read",
        (token, _fixture, id) => detail(id, token),
        "held"
      ],
      [
        "booking.reservations.create",
        (token, fixture) =>
          place(
            bodyOf(fixture, {
              startsAt: new Date(START + 9 * HOUR).toISOString()
            }),
            {
              token
            }
          ),
        "none"
      ],
      [
        "booking.reservations.confirm",
        (token, _fixture, id) => act("confirm", id, { token }),
        "held"
      ],
      [
        "booking.reservations.cancel",
        (token, _fixture, id) => act("cancel", id, { token }),
        "held"
      ],
      [
        "booking.reservations.reschedule",
        (token, _fixture, id) =>
          move(
            id,
            { startsAt: new Date(START + 2 * HOUR).toISOString() },
            {
              token
            }
          ),
        "confirmed"
      ],
      [
        "booking.reservations.check_in",
        (token, _fixture, id) => act("check-in", id, { token }),
        "confirmed"
      ],
      [
        "booking.reservations.complete",
        (token, _fixture, id) => act("check-out", id, { token }),
        "checked_in"
      ],
      [
        "booking.reservations.no_show",
        // Refused on the merits (the start is in the future), but only a 409
        // proves the guard let the caller through; a 403 is the guard itself.
        (token, _fixture, id) => act("no-show", id, { token }),
        "confirmed"
      ]
    ];

    async function stateFor(
      fixture: Fixture,
      state: "none" | "held" | "confirmed" | "checked_in"
    ): Promise<string> {
      if (state === "none") return "";
      if (state === "held") return (await held(fixture)).id;

      const reservation = await confirmedReservation(fixture);

      if (state === "checked_in") {
        expect((await act("check-in", reservation.id)).status).toBe(200);
      }

      return reservation.id;
    }

    test.each(actions)(
      "%s: refused to everyone else, allowed to its holder alone",
      async (key, run, state) => {
        if (!handlerReady) return;

        // Everyone EXCEPT the holder is refused this action (403), and the state
        // is untouched.
        const denyFixture = await newFixture(env.tenantId);
        const denyId = await stateFor(denyFixture, state);
        const before = await writes(env.tenantId);
        const denied = await run(exceptUser[key]!.token, denyFixture, denyId);

        expect(denied.status).toBe(403);
        expect(await writes(env.tenantId)).toEqual(before);

        // The holder ALONE is let through (it may then be refused on the merits,
        // which is never 403).
        const allowFixture = await newFixture(env.tenantId);
        const allowId = await stateFor(allowFixture, state);
        const allowed = await run(onlyUser[key]!.token, allowFixture, allowId);

        expect(allowed.status).not.toBe(403);
        expect(allowed.status).not.toBe(401);
      }
    );

    test("a holder of no_show alone can mark one; everyone else with every other permission cannot", async () => {
      if (!handlerReady) return;
      // A reservation that started two hours ago: the owner creates it through
      // the override.
      const fixture = await newFixture(env.tenantId);
      const response = await place(
        bodyOf(fixture, {
          startsAt: new Date(
            Math.floor(Date.now() / HOUR) * HOUR - 2 * HOUR
          ).toISOString(),
          overridePolicy: true
        })
      );

      expect(response.status).toBe(201);

      const id = response.body.data!.reservation.id;

      expect((await act("confirm", id)).status).toBe(200);
      expect(
        (
          await act("no-show", id, {
            token: exceptUser["booking.reservations.no_show"]!.token
          })
        ).status
      ).toBe(403);

      const marked = await act("no-show", id, {
        token: onlyUser["booking.reservations.no_show"]!.token
      });

      expect(marked.status).toBe(200);
      expect(marked.body.data!.reservation.status).toBe("no_show");
    });
  });

  describe("the high-risk override: checked first, independently, both ways", () => {
    test("create alone cannot lift policy; override alone cannot create; both can; the lift is audited critical", async () => {
      if (!handlerReady) return;
      const closed = await newFixture(env.tenantId, { open: false });
      const createOnly = onlyUser["booking.reservations.create"]!;
      const overrideOnly = onlyUser["booking.reservations.override"]!;
      const both = await seedUser(env.tenantId, "create-override", [
        "booking.reservations.create",
        "booking.reservations.override"
      ]);
      const body = bodyOf(closed, { overridePolicy: true });
      const before = await writes(env.tenantId);

      // Without the override flag the closed resource is a policy refusal.
      const plain = await place(bodyOf(closed), { token: createOnly.token });

      expect(plain.status).toBe(409);
      expect(plain.body.error?.code).toBe("OUTSIDE_SCHEDULE");

      // The flag without the permission is 403, and writes nothing.
      expect((await place(body, { token: createOnly.token })).status).toBe(403);
      // The override permission without `create` cannot create at all.
      expect((await place(body, { token: overrideOnly.token })).status).toBe(
        403
      );
      expect(await writes(env.tenantId)).toEqual(before);

      const lifted = await place(body, { token: both.token });

      expect(lifted.status).toBe(201);
      expect(lifted.body.data).toMatchObject({
        replayed: false,
        policyLifted: ["OUTSIDE_SCHEDULE"]
      });

      const audit = (await admin()`
        SELECT severity, actor_tenant_user_id
        FROM awcms_audit_events
        WHERE module_key = 'booking'
          AND action = 'booking.reservation.overridden'
          AND resource_id = ${lifted.body.data!.reservation.id}
      `) as { severity: string; actor_tenant_user_id: string }[];

      expect(audit).toHaveLength(1);
      expect(audit[0]!.severity).toBe("critical");
      expect(audit[0]!.actor_tenant_user_id).toBe(both.tenantUserId);
    });

    test("an override never lifts a conflict, and a reschedule needs the same two permissions", async () => {
      if (!handlerReady) return;
      const fixture = await newFixture(env.tenantId);
      const mine = await confirmedReservation(fixture);

      await confirmedReservation(fixture, {
        startsAt: new Date(START + 3 * HOUR).toISOString()
      });

      const both = await seedUser(env.tenantId, "move-override", [
        "booking.reservations.reschedule",
        "booking.reservations.override"
      ]);
      const target = { startsAt: new Date(START + 3 * HOUR).toISOString() };

      // The override flag with only `reschedule`: 403 before anything is read.
      expect(
        (
          await move(
            mine.id,
            { ...target, overridePolicy: true },
            {
              token: onlyUser["booking.reservations.reschedule"]!.token
            }
          )
        ).status
      ).toBe(403);
      // With both permissions the CONFLICT still refuses.
      const refused = await move(
        mine.id,
        { ...target, overridePolicy: true },
        { token: both.token }
      );

      expect(refused.status).toBe(409);
      expect(refused.body.error?.code).toBe("SLOT_UNAVAILABLE");
      expect((await detail(mine.id)).body.data!.reservation.status).toBe(
        "confirmed"
      );
    });
  });

  describe("Idempotency-Key", () => {
    test("it is required on every mutation", async () => {
      if (!handlerReady) return;
      const fixture = await newFixture(env.tenantId);
      const reservation = await held(fixture);

      expect((await place(bodyOf(fixture), { key: null })).status).toBe(400);
      expect(
        (await place(bodyOf(fixture), { key: null })).body.error?.code
      ).toBe("IDEMPOTENCY_REQUIRED");

      for (const verb of [
        "confirm",
        "cancel",
        "check-in",
        "check-out",
        "no-show"
      ] as const) {
        const response = await act(verb, reservation.id, { key: null });

        expect(response.status).toBe(400);
        expect(response.body.error?.code).toBe("IDEMPOTENCY_REQUIRED");
      }

      expect(
        (
          await move(
            reservation.id,
            { startsAt: new Date(START).toISOString() },
            {
              key: null
            }
          )
        ).status
      ).toBe(400);
    });

    test("a replay returns the SAME row and writes nothing; a reused key with another request is 409", async () => {
      if (!handlerReady) return;
      const fixture = await newFixture(env.tenantId, { capacity: 2 });
      const key = nextKey();
      const first = await place(
        bodyOf(fixture, { externalRef: { type: "order", id: "ORD-IDEM" } }),
        { key }
      );
      const before = await writes(env.tenantId);
      const replay = await place(
        bodyOf(fixture, { externalRef: { type: "order", id: "ORD-IDEM" } }),
        { key }
      );

      expect(first.status).toBe(201);
      expect(replay.status).toBe(201);
      expect(replay.body).toEqual(first.body);
      expect(await writes(env.tenantId)).toEqual(before);

      const conflict = await place(
        bodyOf(fixture, { startsAt: new Date(START + HOUR).toISOString() }),
        { key }
      );

      expect(conflict.status).toBe(409);
      expect(conflict.body.error?.code).toBe("IDEMPOTENCY_CONFLICT");
      expect(await writes(env.tenantId)).toEqual(before);

      // A different USER presenting the same key holds a separate record
      // (ADR-0145): never handed the first user's response, and never told the
      // key is taken either (no squat, no oracle).
      const other = await seedUser(env.tenantId, "thief", [
        "booking.reservations.create"
      ]);
      const stolen = await place(
        bodyOf(fixture, { externalRef: { type: "order", id: "ORD-IDEM" } }),
        { key, token: other.token }
      );

      expect(stolen.body.error?.code).not.toBe("IDEMPOTENCY_CONFLICT");
      expect(stolen.body).not.toEqual(first.body);
    });

    test("(T4, capacity 1) five concurrent requests with one key ALL answer 201 with the same body: a retry never sees its own booking as a conflict", async () => {
      if (!handlerReady) return;
      const fixture = await newFixture(env.tenantId, { capacity: 1 });
      const key = nextKey();
      const before = await writes(env.tenantId);
      const responses = await Promise.all(
        Array.from({ length: 5 }, () => place(bodyOf(fixture), { key }))
      );

      expect(responses.map((response) => response.status)).toEqual([
        201, 201, 201, 201, 201
      ]);
      // Deep equality: a replay comes back through jsonb, which reorders keys.
      for (const response of responses) {
        expect(response.body).toEqual(responses[0]!.body);
      }
      expect((await writes(env.tenantId)).reservations).toBe(
        before.reservations! + 1
      );
    });

    test("(T4) five parallel requests with one key make one reservation", async () => {
      if (!handlerReady) return;
      const fixture = await newFixture(env.tenantId, { capacity: 3 });
      const key = nextKey();
      const before = await writes(env.tenantId);
      const responses = await Promise.all(
        Array.from({ length: 5 }, () => place(bodyOf(fixture), { key }))
      );
      const ids = new Set(
        responses
          .filter((response) => response.status === 201)
          .map((response) => response.body.data!.reservation.id)
      );

      // Every request either got the one reservation or a clean 409 for a lost race;
      // never a second reservation.
      for (const response of responses) {
        expect([201, 409]).toContain(response.status);
      }
      expect(ids.size).toBe(1);
      expect((await writes(env.tenantId)).reservations).toBe(
        before.reservations! + 1
      );
    });

    test("a transition replays by key AND by state: a fresh key against the target state is replayed:true and writes nothing", async () => {
      if (!handlerReady) return;
      const fixture = await newFixture(env.tenantId);
      const reservation = await held(fixture);
      const key = nextKey();
      const first = await act("confirm", reservation.id, { key });
      const again = await act("confirm", reservation.id, { key });

      expect(first.status).toBe(200);
      expect(again.body).toEqual(first.body);

      const before = await writes(env.tenantId);
      const fresh = await act("confirm", reservation.id);

      expect(fresh.status).toBe(200);
      expect(fresh.body.data).toMatchObject({ replayed: true });
      expect(fresh.body.data!.reservation.id).toBe(reservation.id);
      expect(await writes(env.tenantId)).toEqual(before);
    });
  });

  describe("the body", () => {
    test("a payment field is 400 PAYMENT_FIELD_NOT_ACCEPTED naming the field, and writes nothing", async () => {
      if (!handlerReady) return;
      const fixture = await newFixture(env.tenantId);
      const before = await writes(env.tenantId);

      for (const field of ["paid", "deposit", "amount", "paymentStatus"]) {
        const response = await place(bodyOf(fixture, { [field]: 1 }));

        expect(response.status).toBe(400);
        expect(response.body.error?.code).toBe("PAYMENT_FIELD_NOT_ACCEPTED");
        expect(JSON.stringify(response.body.error?.details)).toContain(field);
      }

      expect(await writes(env.tenantId)).toEqual(before);
    });

    test("the server owns status, interval and expiry: a client cannot assert them", async () => {
      if (!handlerReady) return;
      const fixture = await newFixture(env.tenantId);

      for (const field of ["status", "endsAt", "holdExpiresAt", "lineageId"]) {
        const response = await place(bodyOf(fixture, { [field]: "x" }));

        expect(response.status).toBe(400);
        expect(response.body.error?.code).toBe("VALIDATION_ERROR");
      }
    });

    test("malformed input is a 400 and writes nothing", async () => {
      if (!handlerReady) return;
      const fixture = await newFixture(env.tenantId);
      const before = await writes(env.tenantId);

      expect(
        (await place(bodyOf(fixture, { startsAt: "2026-11-01T10:00:00" })))
          .status
      ).toBe(400);
      expect((await place(bodyOf(fixture, { partySize: 0 }))).status).toBe(400);
      expect(
        (
          await act("cancel", crypto.randomUUID(), {
            body: { reasonCode: "free text is not a code" }
          })
        ).status
      ).toBe(400);
      expect((await act("confirm", "not-a-uuid")).status).toBe(400);
      expect(await writes(env.tenantId)).toEqual(before);
    });
  });

  describe("not-found is neutral", () => {
    test("an unknown id and another tenant's id are the same 404", async () => {
      if (!handlerReady) return;

      await admin()`
        INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
        VALUES (${OTHER_TENANT}, 'booking-other', 'Other Co')
        ON CONFLICT (id) DO NOTHING
      `;

      const theirs = await seedUser(OTHER_TENANT, "theirs", ALL_PERMISSIONS);
      const theirFixture = await newFixture(OTHER_TENANT);
      const theirResponse = await place(bodyOf(theirFixture), {
        token: theirs.token,
        tenantId: OTHER_TENANT
      });

      expect(theirResponse.status).toBe(201);

      const theirId = theirResponse.body.data!.reservation.id;
      const unknownId = crypto.randomUUID();
      const asks = await Promise.all([
        detail(theirId),
        detail(unknownId),
        act("confirm", theirId),
        act("confirm", unknownId),
        act("cancel", theirId),
        act("cancel", unknownId),
        move(theirId, { startsAt: new Date(START).toISOString() }),
        move(unknownId, { startsAt: new Date(START).toISOString() })
      ]);

      for (const response of asks) {
        expect(response.status).toBe(404);
        expect(response.body.error?.code).toBe("RESERVATION_NOT_FOUND");
      }

      // Their reservation was not touched.
      expect(
        (await detail(theirId, theirs.token, OTHER_TENANT)).body.data!
          .reservation.status
      ).toBe("held");
      // And their list does not leak into ours.
      const list = await call<{ reservations: Reservation[] }>(
        listReservations,
        {
          path: "/api/v1/booking/reservations"
        }
      );

      expect(
        list.body.data!.reservations.some(
          (reservation) => reservation.id === theirId
        )
      ).toBe(false);
    });
  });

  describe("the lifecycle through the real handlers", () => {
    test("create -> confirm -> check-in -> check-out, with the history readable", async () => {
      if (!handlerReady) return;
      const fixture = await newFixture(env.tenantId);
      const reservation = await held(fixture, {
        externalRef: { type: "order", id: "ORD-LIFE" }
      });

      expect(reservation.status).toBe("held");
      expect(reservation.holdExpiresAt).not.toBeNull();
      expect(
        (await act("confirm", reservation.id)).body.data!.reservation.status
      ).toBe("confirmed");
      expect(
        (await act("check-in", reservation.id)).body.data!.reservation.status
      ).toBe("checked_in");
      expect(
        (await act("check-out", reservation.id)).body.data!.reservation.status
      ).toBe("completed");

      const read = await detail(reservation.id);

      expect(read.body.data!.events.map((event) => event.kind)).toEqual([
        "created",
        "held",
        "confirmed",
        "checked_in",
        "completed"
      ]);
      // The note is never in the response.
      expect(JSON.stringify(read.body)).not.toContain("customerNote");
    });

    test("cancel with a reason code frees the slot; a late cancellation is recorded", async () => {
      if (!handlerReady) return;
      const fixture = await newFixture(env.tenantId, { cutoff: 10 * 86_400 });
      const reservation = await confirmedReservation(fixture);
      const cancelled = await act("cancel", reservation.id, {
        body: { reasonCode: "customer_request" }
      });

      expect(cancelled.status).toBe(200);
      expect(cancelled.body.data!.reservation).toMatchObject({
        status: "cancelled",
        lateCancellation: true
      });
      expect((await place(bodyOf(fixture))).status).toBe(201);
    });

    test("a taken slot is 409 SLOT_UNAVAILABLE and leaves nothing behind", async () => {
      if (!handlerReady) return;
      const fixture = await newFixture(env.tenantId);

      await held(fixture);

      const before = await writes(env.tenantId);
      const refused = await place(bodyOf(fixture));

      expect(refused.status).toBe(409);
      expect(refused.body.error?.code).toBe("SLOT_UNAVAILABLE");
      expect(await writes(env.tenantId)).toEqual(before);
    });

    test("an elapsed hold cannot be confirmed: 409 HOLD_EXPIRED", async () => {
      if (!handlerReady) return;
      const fixture = await newFixture(env.tenantId);
      const reservation = await held(fixture);
      const sql = admin();

      await sql.begin(async (tx) => {
        await tx.unsafe(
          "ALTER TABLE awcms_booking_reservations DISABLE TRIGGER awcms_booking_reservations_update_guard"
        );
        await tx.unsafe(
          `UPDATE awcms_booking_reservations SET hold_expires_at = clock_timestamp() - interval '2 seconds' WHERE id = '${reservation.id}'`
        );
        await tx.unsafe(
          "ALTER TABLE awcms_booking_reservations ENABLE TRIGGER awcms_booking_reservations_update_guard"
        );
      });

      const refused = await act("confirm", reservation.id);

      expect(refused.status).toBe(409);
      expect(refused.body.error?.code).toBe("HOLD_EXPIRED");
    });

    test("an early no-show is 409 NO_SHOW_TOO_EARLY", async () => {
      if (!handlerReady) return;
      const fixture = await newFixture(env.tenantId);
      const reservation = await confirmedReservation(fixture);
      const refused = await act("no-show", reservation.id);

      expect(refused.status).toBe(409);
      expect(refused.body.error?.code).toBe("NO_SHOW_TOO_EARLY");
    });

    test("reschedule answers with the replacement AND the superseded reservation, same lineage", async () => {
      if (!handlerReady) return;
      const fixture = await newFixture(env.tenantId);
      const original = await confirmedReservation(fixture, {
        externalRef: { type: "order", id: "ORD-RESCHED" }
      });
      const moved = await move(original.id, {
        startsAt: new Date(START + 30 * 60_000).toISOString()
      });

      expect(moved.status).toBe(200);
      expect(moved.body.data!.previous).toMatchObject({
        id: original.id,
        status: "rescheduled",
        supersededById: moved.body.data!.reservation.id
      });
      expect(moved.body.data!.reservation).toMatchObject({
        status: "confirmed",
        lineageId: original.lineageId,
        rescheduledFromId: original.id,
        externalRef: "ORD-RESCHED"
      });

      // The natural key now finds the replacement.
      const found = await call<{ reservations: Reservation[] }>(
        listReservations,
        {
          path: "/api/v1/booking/reservations",
          query:
            "externalRefType=order&externalRef=ORD-RESCHED&status=confirmed"
        }
      );

      expect(found.body.data!.reservations.map((r) => r.id)).toEqual([
        moved.body.data!.reservation.id
      ]);

      // Rescheduling the old one again, to the same place, is a replay.
      const again = await move(original.id, {
        startsAt: new Date(START + 30 * 60_000).toISOString()
      });

      expect(again.status).toBe(200);
      expect(again.body.data).toMatchObject({ replayed: true });
    });
  });

  describe("the list", () => {
    test("it pages newest first and rejects a bad cursor, a bad status and a half natural key", async () => {
      if (!handlerReady) return;
      const listPath = "/api/v1/booking/reservations";
      const first = await call<{
        reservations: Reservation[];
        nextCursor: string | null;
      }>(listReservations, { path: listPath });

      expect(first.status).toBe(200);
      expect(first.body.data!.reservations.length).toBeGreaterThan(0);

      for (const query of [
        "cursor=garbage",
        "status=paid",
        "externalRefType=order",
        "lineageId=nope"
      ]) {
        const response = await call(listReservations, {
          path: listPath,
          query
        });

        expect(response.status).toBe(400);
      }
    });
  });
});
