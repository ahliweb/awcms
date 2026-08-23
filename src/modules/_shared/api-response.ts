export type ApiMeta = {
  correlationId?: string;
  requestId?: string;
};

export type ApiSuccess<TData> = {
  success: true;
  data: TData;
  meta: ApiMeta;
};

export type ApiErrorBody = {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  meta: ApiMeta;
};

type JsonResponseInit = {
  status?: number;
  headers?: Record<string, string>;
};

export function jsonResponse<TBody>(
  body: TBody,
  init: JsonResponseInit = {}
): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...init.headers
    }
  });
}

/**
 * `headers` is the same escape hatch `fail` has always had, added when ADR-0107
 * gave a 200 a header that depends on the request (`Vary: Origin`, and the CORS
 * grant when there is one). Without it the only way to attach a header to a
 * success was to stop using this helper and hand-build the envelope — which is
 * how envelopes drift.
 */
export function ok<TData>(
  data: TData,
  meta: ApiMeta = {},
  headers?: Record<string, string>
): Response {
  return jsonResponse<ApiSuccess<TData>>(
    { success: true, data, meta },
    { status: 200, headers }
  );
}

export function created<TData>(data: TData, meta: ApiMeta = {}): Response {
  return jsonResponse<ApiSuccess<TData>>(
    { success: true, data, meta },
    { status: 201 }
  );
}

export function fail(
  status: number,
  code: string,
  message: string,
  meta: ApiMeta = {},
  details?: unknown,
  headers?: Record<string, string>
): Response {
  return jsonResponse<ApiErrorBody>(
    {
      success: false,
      error: { code, message, ...(details === undefined ? {} : { details }) },
      meta
    },
    { status, headers }
  );
}
