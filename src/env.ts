export interface Env {
  TINYFAT_MODEL?: string;
  TINYFAT_FIREWORKS_BASE_URL?: string;
  TINYFAT_EMAIL_SEND_URL?: string;
  FLIGHT_API_TOKEN?: string;
  FLIGHT_WEBHOOK_TOKEN?: string;
  CRAWDAD_API_BASE?: string;
  CRAWDAD_API_TOKEN?: string;
  FLIGHT_AWARENESS?: DurableObjectNamespace;
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  SUPABASE_ANON_KEY?: string;
  PUBLIC_SUPABASE_ANON_KEY?: string;
}
