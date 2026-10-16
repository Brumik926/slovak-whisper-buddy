import { createFileRoute } from "@tanstack/react-router";
import { AppShell, useNewConversation } from "@/components/AppShell";

export const Route = createFileRoute("/_authenticated/")({
  head: () => ({
    meta: [
      { title: "Brumík – tvoj hlasový spoločník" },
      { name: "description", content: "Začni nový hlasový rozhovor so svojím osobným AI spoločníkom." },
      { property: "og:title", content: "Brumík – tvoj hlasový spoločník" },
      { property: "og:description", content: "Začni nový hlasový rozhovor so svojím osobným AI spoločníkom." },
    ],
  }),
  component: Home,
});

function Home() {
  const newConversation = useNewConversation();
  return (
    <AppShell>
      <main className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
        <button onClick={() => void newConversation()} className="group relative" aria-label="Začať nový rozhovor">
          <span className="orb animate-orb-breathe block h-48 w-48 transition group-hover:scale-105 md:h-56 md:w-56" />
        </button>
        <h1 className="mt-10 text-4xl md:text-5xl">Ahoj, som tu.</h1>
        <p className="mt-3 max-w-sm text-muted-foreground">
          Ťukni na svetlo a začni rozhovor. Každým rozhovorom ťa spoznávam o niečo lepšie.
        </p>
      </main>
    </AppShell>
  );
}
