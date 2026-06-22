export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/test-image-diag
 *
 * Diagnostic endpoint: makes ONE image request to OpenAI and logs
 * every detail about what was sent and what came back.
 *
 * Query params:
 *   ?key=<admin-api-key>   (must match ADMIN_API_KEY env var)
 *   &prompt=...            (override prompt; default: simple red apple)
 *   &size=1024x1536        (override size; default: 1024x1024)
 *   &quality=high          (override quality; default: medium)
 *   &model=gpt-image-2     (override model; default: env OPENAI_IMAGE_MODEL)
 */
export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get('key');
  const adminKey = process.env.ADMIN_API_KEY;
  const oaiKey = process.env.OPENAI_API_KEY;
  // Primary auth: ADMIN_API_KEY. Fallback: last 12 chars of OPENAI_API_KEY.
  const validKey = adminKey
    ? key === adminKey
    : (oaiKey && oaiKey.length >= 12 && key === oaiKey.slice(-12));
  if (!key || !validKey) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // Accept overrides via query params for production-shaped tests
  const paramPrompt = req.nextUrl.searchParams.get('prompt');
  const paramSize = req.nextUrl.searchParams.get('size');
  const paramQuality = req.nextUrl.searchParams.get('quality');
  const paramModel = req.nextUrl.searchParams.get('model');

  const endpoint = 'https://api.openai.com/v1/images/generations';
  const model = paramModel || process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2';
  const apiKey = process.env.OPENAI_API_KEY;
  const keySuffix = apiKey ? `...${apiKey.slice(-6)}` : 'MISSING';
  const keyPrefix = apiKey ? apiKey.slice(0, 7) : 'MISSING';

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
    const result = { error: 'OPENAI_API_KEY is not set', envCheck, endpoint, model };
    console.error('[test-image-diag]', JSON.stringify(result));
    return NextResponse.json(result, { status: 500 });
  }

  const isDalle = model.startsWith('dall-e');
  const chosenPrompt = paramPrompt || 'simple red apple on a white table';
  const chosenSize = paramSize || (isDalle ? '1024x1024' : '1024x1024');
  const chosenQuality = paramQuality || (isDalle ? undefined : 'medium');

  const payload: Record<string, any> = {
    model,
    prompt: chosenPrompt,
    n: 1,
    size: chosenSize,
  };
  if (chosenQuality) payload.quality = chosenQuality;

  const requestMeta = {
    endpoint,
    method: 'POST',
    model,
    size: chosenSize,
    quality: chosenQuality ?? 'N/A',
    n: 1,
    prompt_length: chosenPrompt.length,
    prompt_preview: chosenPrompt.slice(0, 200),
    sdk: 'raw fetch (no SDK)',
    keyPrefix,
    keySuffix,
    envCheck,
    overrides: {
      prompt: !!paramPrompt,
      size: paramSize ?? 'default',
      quality: paramQuality ?? 'default',
      model: paramModel ?? 'default',
    },
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
      signal: AbortSignal.timeout(180_000),
    });
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    const contentType = res.headers.get('content-type') ?? 'null';
    const retryAfterRaw = res.headers.get('retry-after');
    const allHeaders: Record<string, string> = {};
    res.headers.forEach((v, k) => { allHeaders[k] = v; });
    const ratelimitHeaders: Record<string, string> = {};
    res.headers.forEach((v, k) => {
      if (k.startsWith('x-ratelimit') || k.startsWith('x-request') || k.startsWith('openai-')) ratelimitHeaders[k] = v;
    });

    const rawBody = await res.text();
    const isJson = contentType.includes('application/json');
    const isHtml = rawBody.trimStart().startsWith('<') || contentType.includes('text/html');

    let parsedBody: any = null;
    let bodyPreview: string;
    if (isJson) {
      try {
        parsedBody = JSON.parse(rawBody);
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

    let errorDetail = null;
    if (isJson && parsedBody?.error) {
      errorDetail = {
        type: parsedBody.error.type,
        code: parsedBody.error.code,
        message: parsedBody.error.message?.slice(0, 500),
        param: parsedBody.error.param,
      };
    }

    let imageReceived = false;
    if (res.ok && parsedBody?.data?.[0]) {
      const item = parsedBody.data[0];
      imageReceived = !!(item.url || item.b64_json);
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

    const result = {
      request: requestMeta,
      response: responseMeta,
      errorDetail,
      imageReceived,
      verdict: imageReceived
        ? 'SUCCESS - image received. Check OpenAI Usage -> Images to confirm it incremented.'
        : res.ok
          ? 'UNEXPECTED - 200 OK but no image data in response'
          : isHtml
            ? `BLOCKED - HTTP ${res.status} with HTML body. NOT an OpenAI JSON error.`
            : errorDetail
              ? `OPENAI_ERROR - ${errorDetail.type}/${errorDetail.code}: ${errorDetail.message}`
              : `HTTP_${res.status} - unknown error format`,
    };

    console.log('[test-image-diag] RESPONSE', JSON.stringify(result));
    return NextResponse.json(result, { status: res.ok ? 200 : 502 });
  } catch (err: any) {
    const result = {
      request: requestMeta,
      error: err?.message ?? String(err),
      errorName: err?.name,
      verdict: err?.name === 'AbortError'
        ? 'TIMEOUT - request did not complete within 180s'
        : `EXCEPTION - ${err?.message}`,
    };
    console.error('[test-image-diag] EXCEPTION', JSON.stringify(result));
    return NextResponse.json(result, { status: 500 });
  }
}
