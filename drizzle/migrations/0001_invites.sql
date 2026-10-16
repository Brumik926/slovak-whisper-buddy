CREATE TABLE public.invites (
  email text PRIMARY KEY CHECK (email = lower(email)),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, DELETE ON public.invites TO authenticated;
GRANT ALL ON public.invites TO service_role;
ALTER TABLE public.invites ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.allowed_owner WHERE user_id = auth.uid())
$$;

-- is_owner now means "has access": the admin or anyone whose email was invited.
CREATE OR REPLACE FUNCTION public.is_owner() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL AND (
    public.is_admin() OR EXISTS (
      SELECT 1 FROM public.invites WHERE email = lower(coalesce(auth.jwt()->>'email',''))
    )
  )
$$;

CREATE OR REPLACE FUNCTION public.claim_owner() RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN false; END IF;
  INSERT INTO public.allowed_owner (id, user_id) VALUES (1, auth.uid()) ON CONFLICT (id) DO NOTHING;
  RETURN public.is_owner();
END $$;

CREATE POLICY "admin manages invites" ON public.invites FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());