/**
 * `bun test` preload (see `bunfig.toml`).
 *
 * The web process installs the descriptor source in `src/middleware.ts`. A test
 * that calls a route handler directly never goes through the middleware, and
 * the public-form challenge seam is fail-closed without a source (ADR-0164,
 * Issue #1353): "no source" must not mean "no challenge". Installing it once
 * here gives every such test the composition root it stands in for, so none
 * needs a per-file edit. A test that wants to prove the no-source behaviour
 * uninstalls it itself and puts it back.
 */
import { listModules } from "../src/modules";
import { installExtensionPointSource } from "../src/modules/_shared/extension-point-source";

installExtensionPointSource(listModules);
