# Osobný hlasový AI spoločník

Súkromná aplikácia, kde sa s AI rozprávaš živým hlasom. Asistent si z rozhovorov sám pamätá fakty o tebe, tvoje záujmy a štýl odpovedí, ktorý máš rád, a postupne sa prispôsobuje.

## Čo uvidíš
- **Prihlásenie cez Google** – prístup len pre tvoj účet (ostatní sa nedostanú dnu).
- **Zoznam rozhovorov** vľavo (na mobile v rozbaľovacom menu), tlačidlo „Nový rozhovor".
- **Obrazovka rozhovoru** – veľké tlačidlo Začať / Ukončiť hovor, animovaný kruh reagujúci na hlas, priebežné titulky toho, čo hovoríš ty aj asistent. Asistent ťa po spustení sám pozdraví.
- **Stránka „Čo o mne vie"** – prehľad nadobudnutých spomienok (len na čítanie, aby si videl, čo sa naučil).
- Rozhovor prebieha v slovenčine, s prirodzeným hlasom.

## Ako sa učí
- Po každom rozhovore AI prejde prepis a vytiahne nové poznatky (napr. „pracuje ako…", „preferuje stručné odpovede").
- Pri ďalšom hovore dostane asistent tieto poznatky a súhrn predchádzajúcich rozhovorov, takže nadväzuje a odpovedá „na mieru".
- Počas hovoru si vie aj na požiadanie niečo zapamätať či vyhľadať v minulých rozhovoroch.

## Dizajn
Tmavá, pokojná, intímna atmosféra (hlboká modro-čierna, teplý jantárový akcent), výrazný kruhový „hlasový orb", jemné písmo – nie generický vzhľad.

## Technické detaily
- Lovable Cloud: Google prihlásenie, tabuľky `conversations`, `transcript_entries`, `memories` (RLS na vlastníka) + `allowed_owner` – prvý prihlásený účet sa stane jediným povoleným, ďalšie sú odmietnuté.
- Živý hlas cez Lovable AI Live (model `openai/gpt-live-1`) so serverovým relay, klientska delegácia pre nástroje `remember_fact` a `search_past_conversations` (backend model `openai/gpt-6-astra`).
- Po ukončení hovoru serverová funkcia uloží prepis a extrahuje spomienky (štruktúrovaný výstup), plus krátky súhrn rozhovoru.
- Route: `/` (zoznam + nový hovor), `/c/$conversationId`, `/memories`, `/login`; chránené pod `_authenticated`.
