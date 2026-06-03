// Set required env vars BEFORE any module imports config/env.ts.
// dotenv won't override values that are already set, so this takes precedence
// over whatever is in server/.env when running tests.

process.env['DATABASE_URL'] = 'postgresql://test:test@localhost:5432/test';
process.env['JWT_SECRET'] = 'test-secret-that-is-at-least-32-characters!!';
process.env['SUPABASE_URL'] = 'https://test.supabase.co';
process.env['SUPABASE_ANON_KEY'] = 'test-anon-key';
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'test-service-role-key';
process.env['AGORA_APP_ID'] = 'test-agora-app-id';
process.env['AGORA_APP_CERTIFICATE'] = 'test-agora-certificate';
process.env['DEEPGRAM_API_KEY'] = 'test-deepgram-key';
process.env['CLIENT_ORIGIN'] = 'http://localhost:5173';
process.env['LOG_LEVEL'] = 'silent';
