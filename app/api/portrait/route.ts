import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, getAuthUser } from '@/lib/supabase';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY!;
// Imagen 4 Fast via :predict (curl-confirmed working: HTTP 200 with Gemini Developer API key)
// API key has: imagen-4.0-generate-001, imagen-4.0-ultra-generate-001, imagen-4.0-fast-generate-001
// None have :generateImages — all use Vertex-style :predict
const IMAGEN_URL = `https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-fast-generate-001:predict?key=${GEMINI_API_KEY}`;
const BUCKET = 'portraits';

/**
 * POST /api/portrait
 *
 * Lazy portrait generation with Supabase Storage cache.
 * Body: { key: string, prompt: string, aspectRatio?: '1:1' | '2:3' }
 *
 * Cache key → portraits/{key}.webp
 * On miss: calls Imagen 3, uploads, returns URL.
 * On hit:  returns existing public URL immediately.
 */
export async function POST(req: NextRequest) {
    // 1. Auth
    const user = await getAuthUser(req);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // 2. Parse body
    let key: string;
    let prompt: string;
    let aspectRatio: string;
    try {
        const body = await req.json();
        key = body.key?.replace(/[^a-zA-Z0-9_\-:]/g, '_');   // sanitise path
        prompt = body.prompt;
        aspectRatio = body.aspectRatio ?? '2:3';
        if (!key || !prompt) throw new Error('missing key or prompt');
    } catch (e) {
        return NextResponse.json({ error: 'Bad request' }, { status: 400 });
    }

    const storagePath = `${key}.webp`;

    // 3a. Ensure bucket exists (idempotent — ignores error if already exists)
    await supabaseAdmin.storage.createBucket(BUCKET, {
        public: true,
        fileSizeLimit: 2 * 1024 * 1024,  // 2 MB
        allowedMimeTypes: ['image/webp', 'image/png', 'image/jpeg'],
    }).catch(() => { /* bucket already exists — ignore */ });

    // 3b. Cache check — Supabase Storage
    const { data: existing } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(storagePath);
    if (existing?.publicUrl) {
        // Verify file actually exists (getPublicUrl always returns a URL shape, even if 404)
        try {
            const head = await fetch(existing.publicUrl, { method: 'HEAD' });
            if (head.ok) {
                return NextResponse.json({ url: existing.publicUrl, cached: true });
            }
        } catch { /* file doesn't exist, fall through */ }
    }

    // 4. Generate with Imagen 4 Fast — Vertex-style :predict body (confirmed working)
    // Derive negative prompt from aspect ratio (3:4 = character portrait, 1:1 = item)
    const defaultNegativePrompt = aspectRatio === '3:4'
        ? 'empty landscape, scenery without people, no face, multiple characters, crowd, text, watermark, extra limbs, disfigured, bad anatomy, blurry, low quality'
        : 'people, characters, human face, text, watermark, blurry, low quality, cluttered background';
    const negativePrompt = (body as any).negativePrompt || defaultNegativePrompt;

    const imagenRes = await fetch(IMAGEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            instances: [{ prompt, negativePrompt }],
            parameters: {
                sampleCount: 1,
                aspectRatio,
                safetyFilterLevel: 'block_few',
                personGeneration: 'allow_adult',
            },
        }),
        signal: AbortSignal.timeout(45_000),
    });

    if (!imagenRes.ok) {
        const errText = await imagenRes.text().catch(() => '');
        const errJson = errText ? JSON.stringify(errText) : `(empty body, HTTP ${imagenRes.status} ${imagenRes.statusText})`;
        console.error('[portrait] Imagen error status:', imagenRes.status, 'body:', errText || '(empty)');
        return NextResponse.json({ error: 'Imagen failed', detail: errJson, status: imagenRes.status }, { status: 502 });
    }

    const imagenData = await imagenRes.json();
    // Response: { predictions: [{ bytesBase64Encoded: '...', mimeType: 'image/png' }] }
    const b64 = imagenData?.predictions?.[0]?.bytesBase64Encoded;
    if (!b64) {
        return NextResponse.json({ error: 'No image returned from Imagen' }, { status: 502 });
    }

    // 5. Upload to Supabase Storage
    const buffer = Buffer.from(b64, 'base64');
    const { error: uploadErr } = await supabaseAdmin.storage
        .from(BUCKET)
        .upload(storagePath, buffer, {
            contentType: 'image/webp',
            cacheControl: '31536000',   // 1 year CDN cache
            upsert: true,
        });

    if (uploadErr) {
        console.error('[portrait] Storage upload error:', uploadErr);
        // Return base64 as data URI fallback — not cached but usable
        return NextResponse.json({ url: `data:image/webp;base64,${b64}`, cached: false });
    }

    // 6. Return public URL
    const { data: pub } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(storagePath);
    return NextResponse.json({ url: pub.publicUrl, cached: false });
}

export async function OPTIONS() {
    return new NextResponse(null, { status: 204 });
}
