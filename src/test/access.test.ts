// Execute the real migrations against PostgreSQL, including their RLS policies.
// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const db = new PGlite();
const owner = "00000000-0000-4000-8000-000000000001";
const newcomer = "00000000-0000-4000-8000-000000000002";
async function asUser(id: string | null) {
  await db.exec("RESET ROLE");
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [id ?? ""]);
  await db.exec("SET ROLE authenticated");
}

beforeAll(async () => {
  await db.exec(`
    CREATE ROLE authenticated; CREATE ROLE anon; CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$
      SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;
    CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb; $$;
    GRANT USAGE ON SCHEMA auth TO authenticated, anon;
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO authenticated, anon;
  `);
  for (const name of readdirSync("drizzle/migrations").filter((n) => n.endsWith(".sql")).sort()) {
    await db.exec(readFileSync(`drizzle/migrations/${name}`, "utf8"));
  }
  await db.query("INSERT INTO public.allowed_owner (id, user_id) VALUES (1, $1)", [owner]);
  await db.query("INSERT INTO public.conversations (user_id, title) VALUES ($1, 'Owner private conversation')", [owner]);
  await db.query("INSERT INTO public.memories (user_id, content) VALUES ($1, 'Owner private memory')", [owner]);
});
afterAll(async () => { await db.close(); });

describe("Open Google access", () => {
  it("admits a new signed-in user without any invitation", async () => {
    await asUser(newcomer);
    const result = await db.query<{ access: boolean; gate: boolean }>("SELECT public.is_owner() AS access, public.claim_owner() AS gate");
    expect(result.rows).toEqual([{ access: true, gate: true }]);
  });
  it("does not admit a missing user identity", async () => {
    await asUser(null);
    const result = await db.query<{ access: boolean }>("SELECT public.claim_owner() AS access");
    expect(result.rows).toEqual([{ access: false }]);
  });
  it("lets the newcomer store and read only their own conversations and memories", async () => {
    await asUser(newcomer);
    await db.exec("INSERT INTO public.conversations (title) VALUES ('Newcomer conversation'); INSERT INTO public.memories (content) VALUES ('Newcomer memory');");
    expect((await db.query("SELECT title FROM public.conversations")).rows).toEqual([{ title: "Newcomer conversation" }]);
    expect((await db.query("SELECT content FROM public.memories")).rows).toEqual([{ content: "Newcomer memory" }]);
    await expect(db.query("INSERT INTO public.conversations (user_id) VALUES ($1)", [owner])).rejects.toThrow(/row-level security/);
    await asUser(owner);
    expect((await db.query("SELECT title FROM public.conversations")).rows).toEqual([{ title: "Owner private conversation" }]);
  });
});