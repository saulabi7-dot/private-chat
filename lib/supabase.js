import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://xfiavhzhnlkyggvfpuqh.supabase.co';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhmaWF2aHpobmxreWdndmZwdXFoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkzNDMyMzUsImV4cCI6MjEwNDkxOTIzNX0.XB06oYU70_lbNBtNVsZKEvxAh5yKtjIQ_JSXvZOgUpM';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);