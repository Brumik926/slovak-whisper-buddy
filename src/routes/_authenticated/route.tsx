import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/auth", search: { denied: undefined } });
    // The first account to sign in becomes the only owner; everyone else is turned away.
    const { data: isOwner } = await supabase.rpc("claim_owner");
    if (!isOwner) {
      await supabase.auth.signOut();
      throw redirect({ to: "/auth", search: { denied: 1 } });
    }
    return { user: data.user };
  },
  component: () => <Outlet />,
});
