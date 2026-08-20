/**
 * The browser-wired {@link UploadTransport} for {@link uploadMediaBytes}.
 *
 * Split from `media-upload-client.ts` so the orchestration there — what
 * cancels when, which error wins — is testable without a DOM, an
 * `XMLHttpRequest` or a `crypto.subtle`. Everything in this file touches a
 * browser API and nothing in it makes a decision.
 */
import { sendJson, sendJsonForData } from "./admin-form-client";
import type {
  UploadProgress,
  UploadSessionData,
  UploadTransport
} from "./media-upload-client";

const SESSIONS_URL = "/api/v1/media/news-images/upload-sessions";

/**
 * Every mutation on this surface requires `Idempotency-Key`. A fresh uuid per
 * call, so a double-submit replays the first result instead of creating a
 * second pending object.
 */
function idempotency(): Record<string, string> {
  return { "Idempotency-Key": crypto.randomUUID() };
}

export function browserUploadTransport(): UploadTransport {
  return {
    async createSession(input) {
      const result = await sendJsonForData<UploadSessionData>(
        "POST",
        SESSIONS_URL,
        input,
        idempotency()
      );

      return {
        ok: result.ok,
        data: result.data,
        errorCode: result.errorCode
      };
    },

    putBytes({ url, bytes, contentType, onProgress }) {
      // `XMLHttpRequest` rather than `fetch`: only XHR reports upload progress,
      // and this request is the one that takes real time.
      return new Promise((resolve) => {
        const request = new XMLHttpRequest();
        request.open("PUT", url, true);
        request.setRequestHeader("Content-Type", contentType);

        request.upload.onprogress = (event) => {
          const progress: UploadProgress = {
            loaded: event.loaded,
            total: event.lengthComputable ? event.total : null
          };
          onProgress(progress);
        };

        request.onload = () => {
          // R2 answers 200/204 on a successful PUT. Anything else is a failure
          // whose body is XML we deliberately do not surface — the operator
          // acts on "it failed", not on an S3 error code.
          const ok = request.status >= 200 && request.status < 300;
          resolve({
            ok,
            errorCode: ok ? null : `STORAGE_${request.status}`
          });
        };

        request.onerror = () =>
          resolve({ ok: false, errorCode: "NETWORK_ERROR" });
        request.onabort = () => resolve({ ok: false, errorCode: "ABORTED" });
        request.ontimeout = () => resolve({ ok: false, errorCode: "TIMEOUT" });

        request.send(bytes);
      });
    },

    async finalize({ objectId, checksumSha256 }) {
      // The field is omitted rather than sent as null when there is no digest:
      // the validator treats absent and null identically, and omitting says
      // "there is none" without asserting a value.
      const body = checksumSha256 === null ? {} : { checksumSha256 };

      return sendJson(
        "POST",
        `${SESSIONS_URL}/${objectId}/finalize`,
        body,
        idempotency()
      );
    },

    async cancel(objectId) {
      await sendJson(
        "POST",
        `${SESSIONS_URL}/${objectId}/cancel`,
        {},
        idempotency()
      );
    },

    async digest(bytes) {
      // `crypto.subtle` is undefined outside a secure context, and the
      // LAN/offline profile may be plain HTTP. Absent means "send no
      // checksum", which the finalize contract allows — not a failed upload.
      if (typeof crypto === "undefined" || !crypto.subtle) return null;

      const hash = await crypto.subtle.digest("SHA-256", bytes);

      return [...new Uint8Array(hash)]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
    }
  };
}
