CREATE OR REPLACE FUNCTION public.is_owner() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL;
$$;
CREATE OR REPLACE FUNCTION public.claim_owner() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_owner();
$$;
REVOKE EXECUTE ON FUNCTION public.is_owner() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.claim_owner() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_owner() TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_owner() TO authenticated;
COMMENT ON TABLE public.invites IS 'DEPRECATED: Google registration is open to all authenticated users; invitations are no longer used.';
COMMENT ON TABLE public.allowed_owner IS 'DEPRECATED: legacy original owner record; no longer used to gate application access.';