-- =====================================================================
-- Migration: ceremony_snapshots
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- (Run ONLY this file, not the full schema.sql)
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ceremony_snapshots: one row per player per epoch (YYYY-MM)
CREATE TABLE IF NOT EXISTS public.ceremony_snapshots (
    id            uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id       uuid        REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    epoch_period  text        NOT NULL,
    player_name   text        NOT NULL,
    realm         text        NOT NULL,
    prof_path     text        NOT NULL,
    prof_label    text        NOT NULL,
    sig_skill     text        NOT NULL,
    greatness     smallint    NOT NULL,
    epoch_title   text,
    legend        text,
    climax_count  smallint    DEFAULT 0,
    auction_won   text,
    created_at    timestamptz DEFAULT now() NOT NULL,
    updated_at    timestamptz DEFAULT now() NOT NULL,

    UNIQUE (user_id, epoch_period)
);

CREATE INDEX IF NOT EXISTS idx_ceremony_epoch
    ON public.ceremony_snapshots (epoch_period, greatness DESC);

ALTER TABLE public.ceremony_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ceremony_public_read"
    ON public.ceremony_snapshots FOR SELECT USING (true);

CREATE POLICY "ceremony_owner_insert"
    ON public.ceremony_snapshots FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "ceremony_owner_update"
    ON public.ceremony_snapshots FOR UPDATE
    USING (auth.uid() = user_id);
