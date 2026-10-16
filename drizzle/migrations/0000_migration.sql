CREATE TABLE public.allowed_owner (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  user_id uuid NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.allowed_owner TO service_role;
ALTER TABLE public.allowed_owner ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_owner()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.allowed_owner WHERE user_id = auth.uid());
$$;

CREATE OR REPLACE FUNCTION public.claim_owner()
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN false; END IF;
  INSERT INTO public.allowed_owner (id, user_id) VALUES (1, auth.uid()) ON CONFLICT (id) DO NOTHING;
  RETURN EXISTS (SELECT 1 FROM public.allowed_owner WHERE user_id = auth.uid());
END;
$$;
REVOKE EXECUTE ON FUNCTION public.claim_owner() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.is_owner() FROM anon, public;
GRANT EXECUTE ON FUNCTION public.claim_owner() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_owner() TO authenticated;

CREATE TABLE public.conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  title text NOT NULL DEFAULT 'Nový rozhovor',
  summary text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.conversations TO authenticated;
GRANT ALL ON public.conversations TO service_role;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner conversations" ON public.conversations FOR ALL TO authenticated
  USING (user_id = auth.uid() AND public.is_owner()) WITH CHECK (user_id = auth.uid() AND public.is_owner());

CREATE TABLE public.transcript_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL DEFAULT auth.uid(),
  role text NOT NULL,
  text text NOT NULL,
  position int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.transcript_entries TO authenticated;
GRANT ALL ON public.transcript_entries TO service_role;
ALTER TABLE public.transcript_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner transcripts" ON public.transcript_entries FOR ALL TO authenticated
  USING (user_id = auth.uid() AND public.is_owner()) WITH CHECK (user_id = auth.uid() AND public.is_owner());
CREATE INDEX ON public.transcript_entries (conversation_id, created_at, position);

CREATE TABLE public.memories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  content text NOT NULL,
  category text NOT NULL DEFAULT 'fakt',
  source_conversation_id uuid REFERENCES public.conversations(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.memories TO authenticated;
GRANT ALL ON public.memories TO service_role;
ALTER TABLE public.memories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner memories" ON public.memories FOR ALL TO authenticated
  USING (user_id = auth.uid() AND public.is_owner()) WITH CHECK (user_id = auth.uid() AND public.is_owner());