#!/usr/bin/env bun
/**
 * release-latest-flag.ts — invoked as `bun scripts/release-latest-flag.ts <tag>`
 * from `release.yml` (ADR-0119).
 *
 * Deliberately NOT a `package.json` script. It reads its input from STDIN and
 * exists to be one stage of a pipe inside one workflow step; a `bun run` alias
 * would only advertise it as something a human runs by hand, which would be a
 * command that hangs waiting on a pipe that is not there.
 *
 * Memutuskan apakah rilis yang sedang diterbitkan boleh memikul badge
 * **"Latest"** GitHub, lalu mencetak `true` atau `false` untuk dioper apa adanya
 * ke `gh release create --latest=<…>`.
 *
 * ## Kenapa keputusannya diambil di sini, bukan di YAML
 *
 * Perbandingan versinya adalah logika yang bisa salah, dan logika yang bisa
 * salah di dalam blok `run:` adalah logika yang tak pernah diuji sampai sebuah
 * rilis membuktikannya. `shouldMarkReleaseLatest` murni dan punya tesnya
 * sendiri; berkas ini hanya jembatan I/O — membaca daftar rilis dari STDIN,
 * mengambil tag dari argumen, mencetak satu kata.
 *
 * Dipakai begini di `release.yml`:
 *
 * ```bash
 * gh release list --limit 200 --json tagName,isPrerelease,isDraft \
 *   | bun scripts/release-latest-flag.ts "${GITHUB_REF_NAME}"
 * ```
 *
 * ## Gagal-TERTUTUP, dan arah "tertutup" di sini adalah `false`
 *
 * Input yang tak bisa dibaca (JSON rusak, daftar kosong karena `gh` gagal, tag
 * tak berpola) mencetak `false`. Alasannya asimetris: salah mencetak `false`
 * hanya membuat rilis TIDAK memikul badge — terlihat, bisa diperbaiki dengan
 * satu perintah `gh release edit`. Salah mencetak `true` memindahkan badge itu
 * ke versi yang salah dan **tak ada yang melaporkannya**, persis kegagalan yang
 * ADR-0119 tulis untuk dihentikan.
 */
import {
  shouldMarkReleaseLatest,
  type PublishedRelease
} from "./lib/release-verify-checks";

export function decideFromRawInput(tag: string, rawJson: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    return false;
  }

  if (!Array.isArray(parsed)) return false;

  const published = parsed.filter(
    (entry): entry is PublishedRelease =>
      typeof entry === "object" &&
      entry !== null &&
      typeof (entry as PublishedRelease).tagName === "string"
  );

  return shouldMarkReleaseLatest(tag, published);
}

async function main(): Promise<void> {
  const tag = process.argv[2] ?? "";

  if (tag === "") {
    // Ke STDERR, karena STDOUT berkas ini adalah nilai flag dan hanya itu.
    console.error(
      "release:latest-flag — tag rilis wajib diberikan sebagai argumen pertama."
    );
    console.log("false");
    process.exitCode = 1;
    return;
  }

  const raw = await Bun.stdin.text();
  const latest = decideFromRawInput(tag, raw);

  console.error(
    `release:latest-flag — ${tag} ${latest ? "MEMIKUL" : "tidak memikul"} badge "Latest".`
  );
  console.log(latest ? "true" : "false");
}

if (import.meta.main) {
  await main();
}
