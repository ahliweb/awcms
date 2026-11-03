/**
 * Contract and static checks for `social_publishing` (Issue #1145, ADR-0157):
 * the descriptor against the permission seed and the routes, the event seam
 * against the registry and AsyncAPI, the migrations' RLS and grant shape, the
 * "no credential in a job" and "only the dispatcher composes the credential"
 * rules, the composition roots, and the OpenAPI surface. No database.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { listModules } from "../src/modules";
import { noopSocialPublishingPortAdapter } from "../src/modules/blog-content/application/social-publishing-port-noop-adapter";
import { CAPABILITY_CONTRACT_VERSIONS } from "../src/modules/_shared/capability-contract-versions";
import { validateDomainEventPayload } from "../src/modules/domain-event-runtime/domain/envelope";
import {
  DOMAIN_EVENT_TYPE_REGISTRY,
  SOCIAL_JOB_FAILED_EVENT_TYPE as REGISTRY_FAILED,
  SOCIAL_JOB_PUBLISHED_EVENT_TYPE as REGISTRY_PUBLISHED,
  SOCIAL_PUBLICATION_CANCELLED_EVENT_TYPE as REGISTRY_CANCELLED,
  SOCIAL_PUBLICATION_QUEUED_EVENT_TYPE as REGISTRY_QUEUED,
  SOCIAL_PUBLISHING_EVENT_VERSION as REGISTRY_VERSION
} from "../src/modules/domain-event-runtime/domain/event-type-registry";
import { resolveSocialPublishingPort } from "../src/modules/social-publishing/application/social-publishing-port-adapter";
import {
  SOCIAL_JOB_FAILED_EVENT_TYPE,
  SOCIAL_JOB_PUBLISHED_EVENT_TYPE,
  SOCIAL_PUBLICATION_CANCELLED_EVENT_TYPE,
  SOCIAL_PUBLICATION_QUEUED_EVENT_TYPE,
  SOCIAL_PUBLISHING_EVENT_VERSION,
  SOCIAL_PUBLISHING_GUARDS,
  SOCIAL_PUBLISHING_MODULE_KEY
} from "../src/modules/social-publishing/domain/social-publishing-constants";
import { socialPublishingModule } from "../src/modules/social-publishing/module";

const ROOT = path.resolve(import.meta.dir, "..");
const read = (relative: string) =>
  readFileSync(path.join(ROOT, relative), "utf8");

function files(dir: string, extension: string): string[] {
  const absolute = path.join(ROOT, dir);
  const out: string[] = [];

  for (const entry of readdirSync(absolute)) {
    const full = path.join(absolute, entry);

    if (statSync(full).isDirectory()) {
      out.push(...files(path.join(dir, entry), extension));
    } else if (entry.endsWith(extension)) {
      out.push(path.join(dir, entry));
    }
  }

  return out;
}

const MODULE_FILES = files("src/modules/social-publishing", ".ts");
const ROUTE_FILES = files("src/pages/api/v1/social-publishing", ".ts");
const TABLES = [
  "awcms_social_publishing_settings",
  "awcms_social_publish_rules",
  "awcms_social_publications",
  "awcms_social_publish_jobs",
  "awcms_social_publish_attempts"
];

describe("the descriptor", () => {
  test("is a registered, experimental, system module with no navigation entry", () => {
    const registered = listModules().find(
      (module) => module.key === SOCIAL_PUBLISHING_MODULE_KEY
    );

    expect(registered).toBeDefined();
    expect(registered!.type).toBe("system");
    expect(registered!.status).toBe("experimental");
    // A navigation entry without a page is a permanent 404.
    expect(registered!.navigation ?? []).toEqual([]);
    expect(registered!.capabilities?.provides).toEqual(["social_publishing"]);
  });

  test("declares exactly the permissions sql/331 seeds, and every guard names one of them", () => {
    const declared = (socialPublishingModule.permissions ?? [])
      .map((permission) => `${permission.activityCode}.${permission.action}`)
      .sort();
    const seeded = [
      ...read("sql/331_awcms_social_publishing_permissions.sql").matchAll(
        /\('social_publishing', '(\w+)', '(\w+)'/g
      )
    ]
      .map((match) => `${match[1]}.${match[2]}`)
      .sort();

    expect(declared).toEqual(seeded);
    expect(declared).toHaveLength(9);

    const guards = Object.values(SOCIAL_PUBLISHING_GUARDS)
      .map((guard) => `${guard.activityCode}.${guard.action}`)
      .sort();

    expect(guards).toEqual(declared);
  });

  test("every permission is enforced by a route file", () => {
    const routes = ROUTE_FILES.map((file) => read(file)).join("\n");

    for (const name of Object.keys(SOCIAL_PUBLISHING_GUARDS)) {
      expect(routes, name).toContain(`SOCIAL_PUBLISHING_GUARDS.${name}`);
    }
  });

  test("every route authorizes through the factory, and every mutation refuses a machine credential and answers the switch", () => {
    for (const file of ROUTE_FILES) {
      const source = read(file);

      expect(source, file).toContain("defineTenantRoute");
      expect(source, file).toContain("authorize: SOCIAL_PUBLISHING_GUARDS.");
      expect(source, file).not.toContain("withTenant(");

      for (const method of ["POST", "PATCH"]) {
        if (source.includes(`export const ${method} =`)) {
          expect(source, `${file} ${method}`).toContain("mutationRefusal");
          expect(source, `${file} ${method}`).toContain("readIdempotencyKey");
        }
      }

      expect(source, file).toMatch(/mutationRefusal|disabledResponse/);
    }
  });

  test("the non-core module declares the dispatcher job", () => {
    expect(socialPublishingModule.jobs?.map((job) => job.command)).toEqual([
      "bun run social-publishing:dispatch"
    ]);
    expect(read("package.json")).toContain(
      '"social-publishing:dispatch": "bun scripts/social-publishing-dispatch.ts"'
    );
  });
});

describe("the event seam", () => {
  const types = [
    SOCIAL_PUBLICATION_QUEUED_EVENT_TYPE,
    SOCIAL_PUBLICATION_CANCELLED_EVENT_TYPE,
    SOCIAL_JOB_PUBLISHED_EVENT_TYPE,
    SOCIAL_JOB_FAILED_EVENT_TYPE
  ];

  test("the module constants and the registry literals are identical", () => {
    expect(SOCIAL_PUBLISHING_EVENT_VERSION).toBe(REGISTRY_VERSION);
    expect(types).toEqual([
      REGISTRY_QUEUED,
      REGISTRY_CANCELLED,
      REGISTRY_PUBLISHED,
      REGISTRY_FAILED
    ]);
    expect(
      [...(socialPublishingModule.events?.publishes ?? [])].sort()
    ).toEqual([...types].sort());

    for (const type of types) {
      expect(
        DOMAIN_EVENT_TYPE_REGISTRY.some(
          (entry) =>
            entry.eventType === type && entry.eventVersion === REGISTRY_VERSION
        ),
        type
      ).toBe(true);
    }
  });

  test("each event is in the AsyncAPI contract as a channel and an operation", () => {
    const asyncapi = read("asyncapi/awcms-domain-events.asyncapi.yaml");

    for (const type of types) {
      expect(asyncapi).toContain(`  ${type}:\n    address: ${type}`);
      expect(asyncapi).toContain(`$ref: "#/channels/${type}"`);
    }

    for (const schema of [
      "SocialPublicationQueued",
      "SocialPublicationCancelled",
      "SocialJobPublished",
      "SocialJobFailed"
    ]) {
      expect(asyncapi).toContain(`    ${schema}:`);
    }
  });

  test("no producer puts a caption, a title, a link or a credential in an event payload", () => {
    const emit = read(
      "src/modules/social-publishing/application/social-publishing-event-emit.ts"
    );
    const payloads = [
      ...emit.matchAll(/payload:\s*\{([\s\S]*?)\n\s{4}\}/g)
    ].map((match) => match[1]!);

    expect(payloads).toHaveLength(4);

    for (const payload of payloads) {
      expect(payload).not.toMatch(
        /caption|title|linkUrl|link_url|credential|token|secret|externalPost/i
      );
    }

    expect(
      validateDomainEventPayload({
        publicationId: crypto.randomUUID(),
        sourceKind: "article",
        trigger: "post_published",
        state: "ready",
        jobCount: 2,
        accountIds: [crypto.randomUUID(), crypto.randomUUID()]
      }).valid
    ).toBe(true);
  });
});

describe("the migrations", () => {
  const schema = read("sql/330_awcms_social_publishing_schema.sql");

  test("every table is FORCE RLS with a tenant policy that has a WITH CHECK, and the runtime role cannot DELETE", () => {
    for (const table of TABLES) {
      expect(schema, table).toContain(
        `ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`
      );
      expect(schema, table).toContain(
        `ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`
      );
      expect(schema, table).toMatch(
        new RegExp(
          `CREATE POLICY ${table}_tenant_isolation[\\s\\S]*?WITH CHECK \\(tenant_id = current_setting\\('app.current_tenant_id'\\)::uuid\\)`
        )
      );
      expect(schema, table).toMatch(
        new RegExp(
          `REVOKE (UPDATE, )?DELETE, TRUNCATE ON ${table} FROM awcms_app`
        )
      );
      // The worker is granted exactly what it needs, never DELETE.
      expect(schema, table).not.toMatch(
        new RegExp(`GRANT[^;]*DELETE[^;]*ON ${table} TO awcms_worker`)
      );
    }
  });

  test("the attempt ledger is append-only for the runtime role too", () => {
    expect(schema).toContain(
      "REVOKE UPDATE, DELETE, TRUNCATE ON awcms_social_publish_attempts FROM awcms_app"
    );
  });

  test("a job and a publication have no column that could hold a token, a secret or a credential", () => {
    for (const table of TABLES) {
      const body = schema.match(
        new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(([\\s\\S]*?)\\n\\);`)
      )?.[1];

      expect(body, table).toBeDefined();

      const columns = [...body!.matchAll(/^ {2}([a-z_]+) /gm)].map(
        (match) => match[1]!
      );

      expect(columns.length, table).toBeGreaterThan(3);

      for (const column of columns) {
        expect(column, `${table}.${column}`).not.toMatch(
          /token|secret|credential|password|api_?key|bearer|ciphertext/
        );
      }
    }
  });

  test("the integrity triggers exist and carry a pinned search_path", () => {
    for (const name of [
      "awcms_social_publications_snapshot_guard",
      "awcms_social_publish_jobs_guard",
      "awcms_social_publish_jobs_insert_guard"
    ]) {
      expect(schema).toContain(`CREATE TRIGGER ${name}`);
      expect(schema).toContain(`CREATE OR REPLACE FUNCTION ${name}()`);
    }

    expect(
      (schema.match(/SET search_path = public, pg_temp/g) ?? []).length
    ).toBe(3);
    // `published` is terminal, and the job identity is immutable.
    expect(schema).toContain(
      "a published or cancelled social publish job is terminal"
    );
    expect(schema).toContain("a social publish job identity is immutable");
  });

  test("uniqueness: one publication per article event, one job per (publication, account), a tenant-wide idempotency key", () => {
    expect(schema).toContain("awcms_social_publications_article_dedup");
    expect(schema).toContain(
      "awcms_social_publish_jobs_publication_account_key"
    );
    expect(schema).toContain("awcms_social_publish_jobs_idempotency_key_key");
    expect(schema).toContain("awcms_social_publish_attempts_unique_attempt");
  });

  test("H1 of the audit: the worker's secret visibility is NOT widened for this module, and nothing here touches the restrictive policy", () => {
    // No migration of this module may mention the secrets table or its policy.
    for (const file of readdirSync(path.join(ROOT, "sql"))) {
      if (file.includes("social_publishing")) {
        const migration = read(`sql/${file}`);

        expect(migration, file).not.toContain("awcms_channel_secrets");
        expect(migration, file).not.toContain(
          "awcms_channel_secrets_worker_dispatch_purposes"
        );
        expect(migration, file).not.toMatch(/awcms_channel_secrets/i);
      }
    }

    // And the policy that does exist is still WhatsApp-only.
    const policy = read("sql/328_awcms_whatsapp_sender_secret_visibility.sql");

    expect(policy).toContain("a.provider IN ('whatsapp_cloud', 'starsender')");
    expect(policy).not.toMatch(/facebook|instagram|threads|linkedin|youtube/);

    // The dispatch job holds no key ring: no scoped grant, and its script is
    // handed a credential port that refuses everything.
    expect(read("scripts/jobs-env-allowlist.ts")).not.toContain(
      'target: "social-publishing:dispatch"'
    );
    expect(read("ops/awcms-jobs.env-scoped")).not.toContain(
      "social-publishing:dispatch"
    );

    const script = read("scripts/social-publishing-dispatch.ts");

    expect(script).toContain("noPublishCredentialPort");
    expect(script).not.toContain("channel-sender-credential-adapter");
    expect(script).not.toContain("secret-store");
  });

  test("the numbering stays inside the range this issue owns", () => {
    for (const file of readdirSync(path.join(ROOT, "sql"))) {
      if (file.includes("social_publishing")) {
        const number = Number(file.slice(0, 3));

        expect(number).toBeGreaterThanOrEqual(330);
        expect(number).toBeLessThanOrEqual(339);
      }
    }
  });
});

describe("credential and secret handling", () => {
  test("no module file imports the secret store, and only the dispatch script composes the credential adapter", () => {
    for (const file of MODULE_FILES) {
      const source = read(file);

      expect(source, file).not.toContain("secret-store");
      expect(source, file).not.toContain("channel-sender-credential-adapter");
    }

    for (const file of ROUTE_FILES) {
      const source = read(file);

      expect(source, file).not.toContain("secret-store");
      expect(source, file).not.toContain("channel-sender-credential-adapter");
      expect(source, file).not.toContain("resolvePublishCredential");
    }

    // No script composes the publish credential adapter until the first
    // connector brings its own DB role (ADR-0157 section 6).
    for (const file of files("scripts", ".ts")) {
      expect(read(file), file).not.toContain("resolvePublishCredential");

      if (!file.endsWith("whatsapp-dispatch.ts")) {
        expect(read(file), file).not.toContain(
          "channelSenderCredentialAdapter"
        );
      }
    }
  });

  test("application and domain code never import channel_accounts directly (the lazy loaders are the seam)", () => {
    for (const file of MODULE_FILES.filter(
      (candidate) =>
        candidate.includes("/application/") || candidate.includes("/domain/")
    )) {
      expect(read(file), file).not.toMatch(
        /from "\.\.\/\.\.\/channel-accounts\//
      );
    }
  });

  test("a job reads its credential only through the publisher credential port, never a request or a row", () => {
    const dispatch = read(
      "src/modules/social-publishing/application/social-publish-dispatch.ts"
    );

    expect(dispatch).toContain("options.credentials.resolvePublishCredential");
    // The adapter gets an SSRF-safe client and no raw fetch.
    expect(dispatch).toContain("ssrfSafeFetch");
    expect(dispatch).not.toMatch(/\bfetch\(/);

    const adapterContract = read(
      "src/modules/social-publishing/domain/social-publish-adapter.ts"
    );

    expect(adapterContract).toContain("http: SocialPublishHttp");
    expect(adapterContract).not.toMatch(/fetch\??:/);
  });

  test("the fake adapter lives under tests/ and nothing in src or scripts registers an adapter", () => {
    for (const file of [...files("src", ".ts"), ...files("scripts", ".ts")]) {
      const source = read(file);

      expect(source, file).not.toContain("fake-social-publish-adapter");

      if (!file.endsWith("social-adapter-registry.ts")) {
        expect(source, file).not.toMatch(/registerSocialPublishAdapter\(/);
      }
    }

    const script = read("scripts/social-publishing-dispatch.ts");
    const body = script.match(
      /function registerSocialAdapters\(\): void \{([\s\S]*?)\n\}/
    )?.[1];

    // Connectors register here (#1146 to #1151); this slice ships none.
    expect(body?.replace(/\/\/[^\n]*/g, "").trim()).toBe("");
  });
});

describe("the composition roots", () => {
  test("the manual publish route and the scheduled worker choose the port through the flag-gated resolver", () => {
    const route = read("src/pages/api/v1/blog/posts/[id]/publish.ts");
    const script = read("scripts/blog-scheduled-publish.ts");

    for (const source of [route, script]) {
      expect(source).toContain("resolveSocialPublishingPort(");
      expect(source).toContain("noopSocialPublishingPortAdapter");
    }

    // `blog_content`'s application layer still depends on the port TYPE only.
    expect(
      read("src/modules/blog-content/application/blog-scheduled-publish.ts")
    ).not.toMatch(/from "[^"]*social-publishing\//);
  });

  test("the resolver returns the no-op unless the module is enabled", () => {
    const media = {} as never;

    expect(
      resolveSocialPublishingPort(
        noopSocialPublishingPortAdapter,
        media,
        {} as NodeJS.ProcessEnv
      )
    ).toBe(noopSocialPublishingPortAdapter);
    expect(
      resolveSocialPublishingPort(noopSocialPublishingPortAdapter, media, {
        SOCIAL_PUBLISHING_ENABLED: "false"
      } as unknown as NodeJS.ProcessEnv)
    ).toBe(noopSocialPublishingPortAdapter);
    expect(
      resolveSocialPublishingPort(noopSocialPublishingPortAdapter, media, {
        SOCIAL_PUBLISHING_ENABLED: "true"
      } as unknown as NodeJS.ProcessEnv)
    ).not.toBe(noopSocialPublishingPortAdapter);
  });

  test("the no-op adapter is unchanged", async () => {
    expect(
      await noopSocialPublishingPortAdapter.onArticlePublished(
        {} as Bun.SQL,
        "t",
        {
          articleId: "a",
          title: "t",
          slug: "s",
          excerpt: null,
          featuredMediaId: null,
          trigger: "post_published"
        }
      )
    ).toEqual({ jobsCreated: 0 });
  });
});

describe("the contract versions", () => {
  test("channel_account is 1.1.0 and social_publishing is 1.0.0, in the registry and in the family manifest", () => {
    expect(CAPABILITY_CONTRACT_VERSIONS.channel_account).toBe("1.1.0");
    expect(CAPABILITY_CONTRACT_VERSIONS.social_publishing).toBe("1.0.0");

    const manifest = read("awcms-family-compatibility.yaml");

    expect(manifest).toContain('channel_account: "1.1.0"');
    expect(manifest).toContain('social_publishing: "1.0.0"');
  });

  test("the 1.0.0 ports are untouched: the new ports are separate types", () => {
    const port = read("src/modules/_shared/ports/channel-account-port.ts");

    expect(port).toContain("export interface ChannelAccountPort {");
    expect(port).toContain("export interface ChannelPublisherPort {");
    expect(port).toContain("export interface ChannelPublisherCredentialPort {");
    expect(port).toContain("export interface ChannelSenderCredentialPort {");
  });
});

describe("the OpenAPI surface", () => {
  const spec = read("openapi/modules/social-publishing.openapi.yaml");

  test("documents every operation the routes implement", () => {
    for (const operation of [
      "listSocialPublications",
      "createSocialPublication",
      "getSocialPublication",
      "approveSocialPublication",
      "cancelSocialPublication",
      "scheduleSocialPublication",
      "retrySocialPublishJob",
      "listSocialPublishRules",
      "createSocialPublishRule",
      "updateSocialPublishRule",
      "getSocialPublishingSettings",
      "updateSocialPublishingSettings",
      "listSocialPublishProviders"
    ]) {
      expect(spec, operation).toContain(`operationId: ${operation}`);
    }
  });

  test("no request or response property can carry a credential, a provider or a page id", () => {
    const properties = [...spec.matchAll(/^ {8,}([A-Za-z]+):$/gm)].map(
      (match) => match[1]!
    );

    for (const property of properties) {
      expect(property, property).not.toMatch(
        /^(token|accessToken|refreshToken|secret|credential|apiKey|password|pageId|phoneNumberId|providerAccountId)$/
      );
    }
  });

  test("every mutation takes an Idempotency-Key", () => {
    const operations = spec.split(/\n {4}(?=get:|post:|patch:|put:|delete:)/);

    for (const block of operations) {
      if (/^(post|patch|put|delete):/.test(block)) {
        expect(block.slice(0, 600)).toBeDefined();
        expect(block).toContain("components/parameters/IdempotencyKey");
      }
    }
  });
});
