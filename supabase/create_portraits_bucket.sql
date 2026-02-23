-- Create the portraits storage bucket for NPC and item generated portraits
-- Run in Supabase Dashboard > SQL Editor

-- Create bucket (public so portrait URLs work without signed URLs)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'portraits',
    'portraits',
    true,           -- public: portrait URLs are signed via CDN, no auth required
    2097152,        -- 2 MB per file
    ARRAY['image/webp', 'image/png', 'image/jpeg']
)
ON CONFLICT (id) DO NOTHING;

-- RLS: allow service_role to upload (route.ts uses supabaseAdmin = service_role)
CREATE POLICY "Service role can upload portraits"
ON storage.objects FOR INSERT
TO service_role
WITH CHECK (bucket_id = 'portraits');

-- RLS: public read for CDN URLs
CREATE POLICY "Public read portraits"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'portraits');

-- RLS: service_role can upsert (overwrite cached portrait)
CREATE POLICY "Service role can update portraits"
ON storage.objects FOR UPDATE
TO service_role
USING (bucket_id = 'portraits');
