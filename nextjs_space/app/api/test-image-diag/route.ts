export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/test-image-diag
 *
 * Diagnostic endpoint: makes ONE simple image request to OpenAI and logs
 * every detail about what was sent and what came back.
 *
 * Query params:
 *   ?key=<admin-api-key>  (must match ADMIN_API_KEY env var)
 */
export async function GET(req: NextRequest) {
  // Auth gate
  const key = req.nextUrl.searchParams.get('key');
  if (!key || key !== process.env.ADMIN_API_KEY) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const endpoint = 'https://api.openai.com/v1/images/generations';
  const model = process.env.OPENAI_IMAGE_MODEL ?? 'gpt-image-2';
  const apiKey = process.env.OPENAI_API_KEY;
  const keySuffix = apiKey ? `...${apiKey.slice(-6)}` : 'MISSING';
  const keyPrefix = apiKey ? apiKey.slice(0, 7) : 'MISSING';

  // Check for any proxy/base URL env vars
  const envCheck = {
    OPENAI_BASE_URL: process.env.OPENAI_BASE_URL ?? 'NOT_SET',
    OPENAI_API_BASE: process.env.OPENAI_API_BASE ?? 'NOT_SET',
    HTTP_PROXY: process.env.HTTP_PROXY ?? process.env.http_proxy ?? 'NOT_SET',
    HTTPS_PROXY: process.env.HTTPS_PROXY ?? process.env.https_proxy ?? 'NOT_SET',
    ALL_PROXY: process.env.ALL_PROXY ?? process.env.all_proxy ?? 'NOT_SET',
    NO_PROXY: process.env.NO_PROXY ?? process.env.no_proxy ?? 'NOT_SET',
    NODE_EXTRA_CA_CERTS: process.env.NODE_EXTRA_CA_CERTS ?? 'NOT_SET',
  };

  if (!apiKey) {
    const result = {
      error: 'OPENAI_API_KEY is not set',
      envCheck,
      endpoint,
      model,
    };
    console.error('[test-image-diag]', JSON.stringify(result));
    return NextResponse.json(result, { status: 500 });
  }

  const isDalle = model.startsWith('dall-e');
  const payload = {
    model,
    prompt: 'simple red apple on a white table',
    n: 1,
    size: '1024x1024' as string,
    ...(isDalle ? {} : { quality: 'medium' }),
  };

  const requestMeta = {
    endpoint,
    method: 'POST',
    model,
    size: payload.size,
    quality: (payload as any).quality ?? 'NOT_SET (dall-e mode)',
    n: payload.n,
    prompt: payload.prompt,
    sdk: 'raw fetch (no SDK)',
    keyPrefix,
    keySuffix,
    envCheck,
  };

  console.log('[test-image-diag] REQUEST', JSON.stringify(requestMeta));

  try {
    const startTime = Date.now();
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(120_000),
    });
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    // Collect ALL response headers
    const contentType = res.headers.get('content-type') ?? 'null';
    const retryAfterRaw = res.headers.get('retry-after');
    const allHeaders: Record<string, string> = {};
    res.headers.forEach((v, k) => {
      allHeaders[k] = v;
    });
    const ratelimitHeaders: Record<string, string> = {};
    res.headers.forEach((v, k) => {
      if (k.startsWith('x-ratelimit') || k.startsWith('x-request')) ratelimitHeaders[k] = v;
    });

    // Read body
    const rawBody = await res.text();
    const isJson = contentType.includes('application/json');
    const isHtml = rawBody.trimStart().startsWith('<') || contentType.includes('text/html');

    let parsedBody: any = null;
    let bodyPreview: string;
    if (isJson) {
      try {
        parsedBody = JSON.parse(rawBody);
        // Redact image data to keep response small
        if (parsedBody?.data?.[0]?.b64_json) {
          parsedBody.data[0].b64_json = `[BASE64 ${parsedBody.data[0].b64_json.length} chars]`;
        }
        bodyPreview = JSON.stringify(parsedBody).slice(0, 500);
      } catch {
        bodyPreview = rawBody.slice(0, 500);
      }
    } else {
      bodyPreview = rawBody.slice(0, 500);
    }

    const responseMeta = {
      status: res.status,
      statusText: res.statusText,
      elapsed_s: elapsed,
      contentType,
      isJson,
      isHtml,
      retryAfterRaw: retryAfterRaw ?? 'null',
      retryAfterParsed: retryAfterRaw ? parseInt(retryAfterRaw, 10) : null,
      ratelimitHeaders,
      allHeaders,
      bodyPreview,
      bodyLength: rawBody.length,
    };

    // If JSON error, extract structured error
    let errorDetail = null;
    if (isJson && parsedBody?.error) {
      errorDetail = {
        type: parsedBody.error.type,
        code: parsedBody.error.code,
        message: parsedBody.error.message?.slice(0, 500),
        param: parsedBody.error.param,
      };
    }

    // Check success
    let imageReceived = false;
    if (res.ok && parsedBody?.data?.[0]) {
      const item = parsedBody.data[0];
      imageReceived = !!(item.url || item.b64_json);
    }

    const result = {
      request: requestMeta,
      response: responseMeta,
      errorDetail,
      imageReceived,
      verdict: imageReceived
        ? 'SUCCESS — image received. Check OpenAI Usage → Images to confirm it incremented.'
        : res.ok
          ? 'UNEXPECTED — 200 OK but no image data in response'
          : isHtml
            ? `BLOCKED — HTTP ${res.status} with HTML body. This is NOT an OpenAI API JSON error. Likely a CDN/WAF/proxy intercepting the request before it reaches OpenAI.`
            : errorDetail
              ? `OPENAI_ERROR — ${errorDetail.type}/${errorDetail.code}: ${errorDetail.message}`
              : `HTTP_${res.status} — unknown error format`,
    };

    console.log('[test-image-diag] RESPONSE', JSON.stringify(result));
    return NextResponse.json(result, { status: res.ok ? 200 : 502 });
  } catch (err: any) {
    const result = {
      request: requestMeta,
      error: err?.message ?? String(err),
      errorName: err?.name,
      verdict: err?.name === 'AbortError'
        ? 'TIMEOUT — request did not complete within 120s'
        : `EXCEPTION — ${err?.message}`,
    };
    console.error('[test-image-diag] EXCEPTION', JSON.stringify(result));
    return NextResponse.json(result, { status: 500 });
  }
}
