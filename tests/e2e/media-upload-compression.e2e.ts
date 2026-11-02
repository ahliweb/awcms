/**
 * Browser E2E for the `/admin/media` uploader's compression (Issue #1221):
 * an OVERSIZE JPEG is compressed in the browser and accepted, and an OVERSIZE
 * GIF is refused with a message that names the cap. The decision logic is unit
 * tested (`tests/media-image-compression*.test.ts`); this spec is the part a
 * unit test cannot see: the real `createImageBitmap` + canvas encode in a real
 * browser, the page wiring, the live region and the 360 px layout.
 *
 * ## It cannot run everywhere, and says so rather than passing
 *
 * The uploader is rendered only where `NEWS_MEDIA_R2_ENABLED=true` with a full
 * `NEWS_MEDIA_R2_*` block (`src/pages/admin/media.astro`). A deployment without
 * it has no form, and the spec SKIPS with that reason instead of asserting
 * against a page that cannot upload. The default CI `e2e-smoke` job has no R2,
 * so there it skips; run it against a server started with R2 configured (a
 * placeholder bucket is enough, because storage is mocked below).
 *
 * ## Storage and the API are mocked, deliberately
 *
 * What is under test is what the BROWSER sends: the size and type claimed at
 * session creation and the bytes `PUT` to storage. Both are captured by
 * `page.route`. The presigned URL handed back is same-origin
 * (`/__e2e/r2-put`) because the page's CSP `connect-src` would block a
 * cross-origin one before Playwright could answer it. No real R2 object is ever
 * written, so a green run leaves no data behind.
 *
 * ## Why WRITE_WAVE
 *
 * It sends non-GET requests to the upload endpoints. They are fulfilled by the
 * mock and never reach the app, but the wave classification is by what a spec
 * ATTEMPTS (`support/e2e-waves.ts`), which is the rule that stays true when a
 * mock is removed.
 */
import { test, expect, type Page } from "@playwright/test";

const SESSIONS_PATH = "/api/v1/media/news-images/upload-sessions";
const PUT_PATH = "/__e2e/r2-put";

type Captured = {
  sessions: Array<{ mimeType: string; byteSize: number; fileName?: string }>;
  puts: Array<{ bytes: number; contentType: string | undefined }>;
  finalizes: number;
};

/** Mocks the three upload steps and records what the browser sent. */
async function mockUploadFlow(page: Page): Promise<Captured> {
  const captured: Captured = { sessions: [], puts: [], finalizes: 0 };
  const origin = new URL(page.url()).origin;

  await page.route(`**${SESSIONS_PATH}`, async (route) => {
    if (route.request().method() !== "POST") return route.fallback();

    captured.sessions.push(route.request().postDataJSON());
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          objectId: "00000000-0000-4000-8000-000000000e2e",
          objectKey: "news-media/e2e/photo.webp",
          presignedUrl: `${origin}${PUT_PATH}`,
          expiresAt: new Date(Date.now() + 300_000).toISOString()
        }
      })
    });
  });

  await page.route(`**${PUT_PATH}`, async (route) => {
    captured.puts.push({
      bytes: route.request().postDataBuffer()?.length ?? 0,
      contentType: route.request().headers()["content-type"]
    });
    await route.fulfill({ status: 200, body: "" });
  });

  await page.route(`**${SESSIONS_PATH}/*/finalize`, async (route) => {
    captured.finalizes += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: { objectId: "e2e" } })
    });
  });

  await page.route(`**${SESSIONS_PATH}/*/cancel`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "{}"
    });
  });

  return captured;
}

async function openUploader(page: Page): Promise<number> {
  await page.goto("/admin/media");

  const form = page.locator("#media-upload-form");
  test.skip(
    (await form.count()) === 0,
    "The uploader is rendered only with NEWS_MEDIA_R2_ENABLED=true and a full NEWS_MEDIA_R2_* block; this server has none."
  );

  const cap = Number(await form.getAttribute("data-max-bytes"));
  expect(Number.isInteger(cap) && cap > 0).toBe(true);

  return cap;
}

test.describe("media uploader compression", () => {
  test("an oversize JPEG is compressed in the browser and accepted", async ({
    page
  }) => {
    test.setTimeout(120_000);

    const cap = await openUploader(page);
    const captured = await mockUploadFlow(page);

    // A noisy photo-like JPEG, built in the page so no multi-MB payload crosses
    // the Playwright bridge. Random pixels are the worst case for a JPEG, so it
    // is comfortably over 2 MiB and the compressor has to work for it.
    const originalSize = await page.evaluate(async (limit) => {
      const width = 3600;
      const height = 2700;
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d")!;
      const image = context.createImageData(width, height);
      const noise = new Uint8Array(65_536);
      for (let offset = 0; offset < image.data.length; offset += noise.length) {
        crypto.getRandomValues(noise);
        image.data.set(
          noise.subarray(0, Math.min(noise.length, image.data.length - offset)),
          offset
        );
      }
      for (let i = 3; i < image.data.length; i += 4) image.data[i] = 255;
      context.putImageData(image, 0, 0);

      const blob = await new Promise<Blob>((resolve) =>
        canvas.toBlob((value) => resolve(value!), "image/jpeg", 0.95)
      );
      if (blob.size <= limit) return blob.size;

      const transfer = new DataTransfer();
      transfer.items.add(
        new File([blob], "phone-photo.jpg", { type: "image/jpeg" })
      );
      (document.getElementById("media-upload-file") as HTMLInputElement).files =
        transfer.files;

      return blob.size;
    }, cap);

    test.skip(
      originalSize <= cap,
      "The configured cap is larger than the generated test image; nothing to compress."
    );

    await page.locator("#media-upload-submit").click();

    // The compressing state is announced through a polite live region...
    const note = page.locator("#media-upload-compression");
    await expect(note).toHaveAttribute("role", "status");
    await expect(note).toHaveAttribute("aria-live", "polite");

    // ...and the session claims the size and type of what is actually sent.
    await expect
      .poll(() => captured.sessions.length, { timeout: 90_000 })
      .toBe(1);
    const [session] = captured.sessions;

    expect(session!.byteSize).toBeGreaterThan(0);
    expect(session!.byteSize).toBeLessThanOrEqual(cap);
    expect(["image/webp", "image/jpeg"]).toContain(session!.mimeType);

    await expect.poll(() => captured.puts.length).toBe(1);
    expect(captured.puts[0]!.bytes).toBe(session!.byteSize);
    expect(captured.puts[0]!.contentType).toBe(session!.mimeType);
    await expect.poll(() => captured.finalizes).toBe(1);

    // Nothing was refused.
    await expect(page.locator("#media-upload-error")).toBeHidden();
  });

  test("an oversize GIF is refused with a message that names the cap, and nothing is sent", async ({
    page
  }) => {
    const cap = await openUploader(page);
    const captured = await mockUploadFlow(page);

    await page.evaluate((limit) => {
      // A GIF header followed by padding: the planner decides on type and size,
      // and a GIF is never decoded, so the body only has to be the right size.
      const bytes = new Uint8Array(limit + 1024);
      bytes.set(new TextEncoder().encode("GIF89a"), 0);
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], "spin.gif", { type: "image/gif" }));
      (document.getElementById("media-upload-file") as HTMLInputElement).files =
        transfer.files;
    }, cap);

    await page.locator("#media-upload-submit").click();

    const error = page.locator("#media-upload-error");
    await expect(error).toBeVisible();
    await expect(error).toContainText("GIF");
    // The cap is stated in binary units, whatever the interface language.
    await expect(error).toContainText(/MiB|KiB/);

    expect(captured.sessions).toHaveLength(0);
    expect(captured.puts).toHaveLength(0);

    // The form is usable again, with the file input and button unlocked.
    await expect(page.locator("#media-upload-submit")).toBeEnabled();
    await expect(page.locator("#media-upload-file")).toBeEnabled();
  });

  test("a file already within the cap is sent unchanged", async ({ page }) => {
    await openUploader(page);
    const captured = await mockUploadFlow(page);

    await page.evaluate(() => {
      const bytes = new Uint8Array(4096);
      bytes.set([0xff, 0xd8, 0xff, 0xe0], 0);
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], "tiny.jpg", { type: "image/jpeg" }));
      (document.getElementById("media-upload-file") as HTMLInputElement).files =
        transfer.files;
    });

    await page.locator("#media-upload-submit").click();

    await expect.poll(() => captured.sessions.length).toBe(1);
    expect(captured.sessions[0]).toMatchObject({
      mimeType: "image/jpeg",
      byteSize: 4096
    });
    await expect.poll(() => captured.puts.length).toBe(1);
    expect(captured.puts[0]!.bytes).toBe(4096);
  });

  test("the uploader fits a 360 px screen, with the refusal showing", async ({
    browser
  }) => {
    // `newContext({ viewport })`, not `viewportSize`: the latter is silently
    // ignored. See the awcms-browser-test skill.
    const context = await browser.newContext({
      viewport: { width: 360, height: 740 },
      storageState: "playwright/.auth/owner.json"
    });
    const page = await context.newPage();

    try {
      const cap = await openUploader(page);
      expect(await page.evaluate(() => window.innerWidth)).toBe(360);

      await page.evaluate((limit) => {
        const bytes = new Uint8Array(limit + 1024);
        bytes.set(new TextEncoder().encode("GIF89a"), 0);
        const transfer = new DataTransfer();
        transfer.items.add(
          new File([bytes], "spin.gif", { type: "image/gif" })
        );
        (
          document.getElementById("media-upload-file") as HTMLInputElement
        ).files = transfer.files;
      }, cap);

      await page.locator("#media-upload-submit").click();
      await expect(page.locator("#media-upload-error")).toBeVisible();

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth
      );
      expect(overflow).toBeLessThanOrEqual(0);
    } finally {
      await context.close();
    }
  });
});
