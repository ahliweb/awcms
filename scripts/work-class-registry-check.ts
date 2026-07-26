#!/usr/bin/env bun
/**
 * `bun run db:work-class:check` — Issue #263.
 *
 * Regenerates the work-class snapshot in memory and diffs it against the
 * committed `docs/awcms/work-class-registry.generated.json`. A new route, a
 * reclassified route, a new worker script, or a changed job rationale all move
 * the snapshot, so none of them can merge without a reviewable diff to that
 * file.
 *
 * Same generate/check pair as `modules:composition:inventory:*`, deliberately:
 * that artifact has stayed accurate for exactly this reason, while
 * `work-class-registry.generated.json` — same suffix, no pair — rotted into a
 * list of awcms-mini ghosts.
 */
import {
  buildSnapshot,
  REGISTRY_PATH,
  serialize
} from "./work-class-registry-generate";

async function main(): Promise<void> {
  const expected = serialize(await buildSnapshot());
  const file = Bun.file(REGISTRY_PATH);

  if (!(await file.exists())) {
    console.error(
      `db:work-class:check GAGAL — ${REGISTRY_PATH} tidak ada. Jalankan ` +
        "`bun run db:work-class:generate` dan commit hasilnya."
    );
    process.exit(1);
  }

  const actual = await file.text();

  if (actual === expected) {
    const snapshot = JSON.parse(actual) as {
      routes: { source: string }[];
      jobs: unknown[];
    };
    const defaults = snapshot.routes.filter(
      (route) => route.source === "default"
    ).length;

    console.log(
      `db:work-class:check OK — ${REGISTRY_PATH} cocok dengan regenerasi segar ` +
        `(${snapshot.routes.length} rute, ${defaults} masih default "interactive", ` +
        `${snapshot.jobs.length} job).`
    );
    process.exit(0);
  }

  console.error(
    `db:work-class:check GAGAL — ${REGISTRY_PATH} tidak cocok dengan regenerasi ` +
      "segar dari rute + job nyata. Jalankan `bun run db:work-class:generate` " +
      "dan commit hasilnya."
  );
  process.exit(1);
}

if (import.meta.main) {
  await main();
}
