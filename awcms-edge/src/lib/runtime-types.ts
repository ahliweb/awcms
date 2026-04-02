export type Bindings = {
  STORAGE: R2Bucket
  VITE_SUPABASE_URL: string
  VITE_SUPABASE_PUBLISHABLE_KEY: string
  SUPABASE_SECRET_KEY: string
  R2_ACCOUNT_ID: string
  R2_ACCESS_KEY_ID: string
  R2_SECRET_ACCESS_KEY: string
  R2_BUCKET_NAME: string
  MEDIA_SECURE_SESSION_MAX_AGE_SECONDS?: string
  MAILKETING_API_TOKEN: string
  MAILKETING_DEFAULT_LIST_ID?: string
  GITHUB_REBUILD_TOKEN?: string
  GITHUB_REBUILD_OWNER?: string
  GITHUB_REBUILD_REPO?: string
  GITHUB_REBUILD_EVENT_TYPE?: string
  SMANDAPBUN_REBUILD_WEBHOOK_SECRET?: string
  TURNSTILE_SECRET_KEY?: string
  CORS_ALLOWED_ORIGINS?: string
  MEDIA_EVENTS_QUEUE: Queue<unknown>
  NOTIFICATIONS_QUEUE: Queue<unknown>
}

export type Variables = {
  user: any
  token: string
  supabase: any
}

export type UserContext = {
  id: string
  tenantId: string | null
  isPlatformAdmin: boolean
  isFullAccess: boolean
}

export type AppEnv = {
  Bindings: Bindings
  Variables: Variables
}
