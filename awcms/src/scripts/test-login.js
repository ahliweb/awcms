
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Load .env from root
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'http://127.0.0.1:54321';
const supabaseKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY; // Use publishable key for login

if (!supabaseKey) {
    console.error('Missing VITE_SUPABASE_PUBLISHABLE_KEY');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function testLogin() {
    console.log('Attempting login with cms@ahliweb.com ...');

    const { data, error } = await supabase.auth.signInWithPassword({
        email: 'cms@ahliweb.com',
        password: 'password123',
    });

    if (error) {
        console.error('Login Failed:', error);
        // console.log('Error Details:', JSON.stringify(error, null, 2));
    } else {
        console.log('Login Success!');
        console.log('User ID:', data.user.id);
        console.log('Session:', data.session ? 'Active' : 'No Session');
    }
}

testLogin();
