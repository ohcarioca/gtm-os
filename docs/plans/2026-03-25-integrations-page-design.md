# Integrations Page Design

## Overview

Dedicated integrations page (`/settings/integrations`) where users manage external service connections: LinkedIn login and Serper API key. Replaces .env-based configuration with DB-stored, encrypted credentials.

## Page Structure

Two cards on the page:

### 1. LinkedIn Integration

- **Status indicator:** green (connected) / red (disconnected)
- **Connect button:** opens Playwright browser (headless: false) for manual LinkedIn login
- **Reconnect button:** shown when already connected, same flow
- Uses existing persistent browser at `~/.gtm-agent/linkedin-browser/`
- Status check: navigates to linkedin.com/feed in headless mode and checks if redirected to login

### 2. Serper (Google Search) Integration

- **API key input:** masked display (`••••••last4`), text input for new key
- **Save button:** encrypts with AES-256-GCM, stores in `api_keys` table
- **Status indicator:** configured / not configured
- **Delete button:** removes stored key

## Database

New table `api_keys`:

```sql
CREATE TABLE api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  service TEXT NOT NULL,
  encrypted_key TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, service)
);

ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own API keys"
  ON api_keys FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
```

## API Routes

### `POST /api/linkedin/open-browser`
- Opens Playwright browser with `headless: false` pointing to linkedin.com/login
- Returns immediately (browser stays open for user)
- Browser uses persistent userDataDir at `~/.gtm-agent/linkedin-browser/`

### `GET /api/linkedin/status`
- Opens headless Playwright with same userDataDir
- Navigates to linkedin.com/feed
- Returns `{ connected: boolean }` based on whether it redirects to login
- Frontend polls this after opening browser

## Navigation

- New sidebar item: "Integracoes" with `Plug` icon
- Position: between "Perfil ICP" and "Empresas"
- Route: `/settings/integrations`

## google-search.ts Changes

- Add `getSerperKey(userId)` that tries DB first, falls back to `process.env.SERPER_API_KEY`
- Requires userId parameter passed through agent state
- Fallback ensures backward compatibility during migration

## Security

- API keys encrypted with existing AES-256-GCM (src/lib/encryption.ts)
- RLS on api_keys table
- Key never sent back to frontend in full (only last 4 chars)
- All inputs validated with Zod
