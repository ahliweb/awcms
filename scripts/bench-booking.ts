/**
 * Entry point of `bun run bench:booking` (Issue #967): reproducible load,
 * stress and concurrency benchmarks for `booking` and `hr_workforce`
 * attendance ingest. The implementation, its scenarios and its thresholds are in
 * `tests/bench/booking-bench.ts`; the numbers and the hardware they were taken
 * on are in `docs/awcms/booking-benchmarks.md`. Deliberately not a `*.test.ts`
 * and not part of `bun run check`.
 */
import { main } from "../tests/bench/booking-bench";

process.exit(await main());
