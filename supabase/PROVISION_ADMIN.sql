-- ==============================================================================
-- OKADA BOOK — OWNER INITIAL ADMINISTRATOR PROVISIONING SCRIPT
-- ==============================================================================
-- Run this script in the Supabase Dashboard SQL Editor:
-- https://supabase.com/dashboard/project/bftlhbxhipbfmwbajcjf/sql/new
--
-- This script securely provisions the ONE initial Owner Administrator account.
-- It links directly to auth.users.id and records the super_admin role in
-- public.admin_users, which is protected by Row Level Security.
-- ==============================================================================

-- 0. Ensure public.admin_users table exists
CREATE TABLE IF NOT EXISTS public.admin_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'super_admin' CHECK (role IN ('super_admin', 'admin')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;

-- ==============================================================================
-- OPTION A (RECOMMENDED): PROMOTE AN EXISTING AUTH USER TO SUPER_ADMIN
-- ==============================================================================
-- If you created your user in Supabase Dashboard (Authentication > Users > Add User),
-- simply replace 'owner@okadabook.com' below with your actual owner email:

DO $$
DECLARE
  v_owner_email TEXT := 'owner@okadabook.com'; -- <<< CHANGE THIS TO YOUR OWNER EMAIL
  v_user_id UUID;
BEGIN
  -- 1. Find user in auth.users
  SELECT id INTO v_user_id
  FROM auth.users
  WHERE email = LOWER(TRIM(v_owner_email));

  IF v_user_id IS NULL THEN
    RAISE NOTICE 'User with email % was not found in auth.users. Please create the user in Supabase Dashboard (Auth -> Users) first or use Option B below.', v_owner_email;
  ELSE
    -- 2. Insert into public.admin_users
    INSERT INTO public.admin_users (user_id, email, role)
    VALUES (v_user_id, LOWER(TRIM(v_owner_email)), 'super_admin')
    ON CONFLICT (user_id) DO UPDATE SET
      role = 'super_admin',
      email = EXCLUDED.email,
      updated_at = timezone('utc'::text, now());

    RAISE NOTICE 'SUCCESS: User % (UUID %) has been provisioned as SUPER_ADMIN.', v_owner_email, v_user_id;
  END IF;
END $$;


-- ==============================================================================
-- OPTION B: DIRECT ALL-IN-ONE PROVISIONING VIA SQL (Creates Auth User + Admin Role)
-- ==============================================================================
-- If you prefer to create both the Auth credentials and Admin Role in one SQL step:
-- Uncomment and run the block below with your chosen credentials:

/*
DO $$
DECLARE
  v_new_email TEXT := 'owner@okadabook.com';        -- <<< Set your admin email
  v_new_password TEXT := 'OkadaOwner2026!Secure';   -- <<< Set your strong password
  v_user_id UUID := gen_random_uuid();
  v_encrypted_pw TEXT;
BEGIN
  -- Verify if user already exists
  IF EXISTS (SELECT 1 FROM auth.users WHERE email = LOWER(TRIM(v_new_email))) THEN
    SELECT id INTO v_user_id FROM auth.users WHERE email = LOWER(TRIM(v_new_email));
  ELSE
    -- Generate bcrypt encrypted password hash
    v_encrypted_pw := crypt(v_new_password, gen_salt('bf'));

    -- Insert into auth.users directly
    INSERT INTO auth.users (
      instance_id,
      id,
      aud,
      role,
      email,
      encrypted_password,
      email_confirmed_at,
      raw_app_meta_data,
      raw_user_meta_data,
      created_at,
      updated_at,
      confirmation_token,
      recovery_token
    ) VALUES (
      '00000000-0000-0000-0000-000000000000',
      v_user_id,
      'authenticated',
      'authenticated',
      LOWER(TRIM(v_new_email)),
      v_encrypted_pw,
      timezone('utc'::text, now()),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"role":"admin"}'::jsonb,
      timezone('utc'::text, now()),
      timezone('utc'::text, now()),
      '',
      ''
    );

    -- Insert into auth.identities with id as UUID and provider_id as text
    INSERT INTO auth.identities (
      id, provider_id, user_id, identity_data, provider,
      last_sign_in_at, created_at, updated_at
    ) VALUES (
      v_user_id, v_user_id::text, v_user_id,
      json_build_object('sub', v_user_id::text, 'email', LOWER(TRIM(v_new_email))),
      'email', timezone('utc'::text, now()), timezone('utc'::text, now()), timezone('utc'::text, now())
    );
  END IF;

  -- Insert into public.admin_users
  INSERT INTO public.admin_users (user_id, email, role)
  VALUES (v_user_id, LOWER(TRIM(v_new_email)), 'super_admin')
  ON CONFLICT (user_id) DO UPDATE SET
    role = 'super_admin',
    email = EXCLUDED.email,
    updated_at = timezone('utc'::text, now());

  RAISE NOTICE 'SUCCESS: Initial Admin % created and authorized.', v_new_email;
END $$;
*/

-- ==============================================================================
-- VERIFICATION QUERY
-- Run this query anytime to see authorized administrators:
-- ==============================================================================
SELECT
  a.id AS admin_record_id,
  a.user_id,
  a.email,
  a.role,
  a.created_at,
  u.last_sign_in_at
FROM public.admin_users a
JOIN auth.users u ON u.id = a.user_id;
