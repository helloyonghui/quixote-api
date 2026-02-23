-- =====================================================================
-- Quixote Game Saves — Supabase Database Schema
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- =====================================================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─────────────────────────────────────────────────────────────────────
-- Table: game_saves
-- Stores the full serialized GameState (Zustand store) per user per slot
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.game_saves (
    id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id     uuid        REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    save_slot   smallint    DEFAULT 1 NOT NULL,           -- 1-3 save slots per user
    game_state  jsonb       NOT NULL,                     -- full Zustand state snapshot
    created_at  timestamptz DEFAULT now() NOT NULL,
    updated_at  timestamptz DEFAULT now() NOT NULL,

    UNIQUE (user_id, save_slot)
);

-- Index for fast user lookups
CREATE INDEX IF NOT EXISTS idx_game_saves_user_id ON public.game_saves (user_id);

-- ─────────────────────────────────────────────────────────────────────
-- Row Level Security (RLS)
-- Users can only read/write their own saves
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.game_saves ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own saves"
    ON public.game_saves FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own saves"
    ON public.game_saves FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own saves"
    ON public.game_saves FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own saves"
    ON public.game_saves FOR DELETE
    USING (auth.uid() = user_id);

-- Note: The API server uses the service_role key which bypasses RLS.
-- RLS here is a defence-in-depth measure if client-side Supabase is also used.

-- ─────────────────────────────────────────────────────────────────────
-- Table: ceremony_snapshots
-- One row per player per epoch (YYYY-MM). Leaderboard readable by all.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ceremony_snapshots (
    id            uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id       uuid        REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    epoch_period  text        NOT NULL,          -- e.g. "2026-02"
    player_name   text        NOT NULL,
    realm         text        NOT NULL,
    prof_path     text        NOT NULL,
    prof_label    text        NOT NULL,
    sig_skill     text        NOT NULL,
    greatness     smallint    NOT NULL,
    epoch_title   text,
    legend        text,                          -- LLM 1-line journey summary
    climax_count  smallint    DEFAULT 0,
    auction_won   text,                          -- auction item id if won
    created_at    timestamptz DEFAULT now() NOT NULL,
    updated_at    timestamptz DEFAULT now() NOT NULL,

    UNIQUE (user_id, epoch_period)
);

CREATE INDEX IF NOT EXISTS idx_ceremony_epoch ON public.ceremony_snapshots (epoch_period, greatness DESC);

-- RLS: public leaderboard reads; only owner can write
ALTER TABLE public.ceremony_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ceremony_public_read"
    ON public.ceremony_snapshots FOR SELECT USING (true);

CREATE POLICY "ceremony_owner_insert"
    ON public.ceremony_snapshots FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "ceremony_owner_update"
    ON public.ceremony_snapshots FOR UPDATE
    USING (auth.uid() = user_id);
