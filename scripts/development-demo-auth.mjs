#!/usr/bin/env node

import { createClient } from "@supabase/supabase-js";

const DEMO_PASSWORD =
  process.env.RIFLELEAGUES_DEMO_PASSWORD ?? "RifleLeagues-Demo-2026!";

const demoUsers = [
  ["basildon.demo01@example.com", "Eleanor", "Hughes"],
  ["basildon.demo02@example.com", "Oliver", "Bennett"],
  ["basildon.demo03@example.com", "Amelia", "Clarke"],
  ["basildon.demo04@example.com", "George", "Foster"],
  ["basildon.demo05@example.com", "Sophie", "Turner"],
  ["basildon.demo06@example.com", "Harry", "Collins"],
  ["basildon.demo07@example.com", "Isla", "Morgan"],
  ["basildon.demo08@example.com", "Jack", "Ward"],
  ["basildon.demo09@example.com", "Emily", "Price"],
  ["basildon.demo10@example.com", "Thomas", "Reed"],
  ["northbridge.demo01@example.com", "Charlotte", "Wilson"],
  ["northbridge.demo02@example.com", "James", "Hall"],
  ["northbridge.demo03@example.com", "Grace", "Walker"],
  ["northbridge.demo04@example.com", "Alfie", "Robinson"],
  ["northbridge.demo05@example.com", "Phoebe", "Wood"],
  ["northbridge.demo06@example.com", "Henry", "Thompson"],
  ["northbridge.demo07@example.com", "Lucy", "Green"],
  ["northbridge.demo08@example.com", "Oscar", "Harris"],
  ["northbridge.demo09@example.com", "Freya", "Martin"],
  ["northbridge.demo10@example.com", "William", "Cooper"],
  ["westmere.demo01@example.com", "Alice", "Davidson"],
  ["westmere.demo02@example.com", "Arthur", "Scott"],
  ["westmere.demo03@example.com", "Matilda", "Brown"],
  ["westmere.demo04@example.com", "Frederick", "Taylor"],
  ["westmere.demo05@example.com", "Evie", "Anderson"],
  ["westmere.demo06@example.com", "Leo", "Mitchell"],
  ["westmere.demo07@example.com", "Poppy", "White"],
  ["westmere.demo08@example.com", "Archie", "Moore"],
  ["westmere.demo09@example.com", "Rosie", "Jackson"],
  ["westmere.demo10@example.com", "Samuel", "Hill"],
  ["southessex.demo01@example.com", "Harriet", "Evans"],
  ["southessex.demo02@example.com", "Edward", "King"],
  ["southessex.demo03@example.com", "Florence", "Wright"],
  ["southessex.demo04@example.com", "Charlie", "Baker"],
  ["southessex.demo05@example.com", "Daisy", "Adams"],
  ["southessex.demo06@example.com", "Alexander", "Nelson"],
  ["southessex.demo07@example.com", "Molly", "Carter"],
  ["southessex.demo08@example.com", "Joseph", "Phillips"],
  ["southessex.demo09@example.com", "Lily", "Campbell"],
  ["southessex.demo10@example.com", "Daniel", "Parker"],
].map(([email, firstName, lastName]) => ({ email, firstName, lastName }));

const supabaseUrl =
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error(
    "Set SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY).",
  );
}

if (DEMO_PASSWORD.length < 12) {
  throw new Error("RIFLELEAGUES_DEMO_PASSWORD must contain at least 12 characters.");
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false,
  },
});

async function listAllUsers() {
  const users = [];
  const perPage = 1000;

  for (let page = 1; ; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage,
    });

    if (error) throw error;
    users.push(...data.users);
    if (data.users.length < perPage) return users;
  }
}

const existingByEmail = new Map(
  (await listAllUsers())
    .filter((user) => user.email)
    .map((user) => [user.email.toLowerCase(), user]),
);

let created = 0;
let refreshed = 0;

for (const demoUser of demoUsers) {
  const existing = existingByEmail.get(demoUser.email);
  const userMetadata = {
    first_name: demoUser.firstName,
    last_name: demoUser.lastName,
  };
  const appMetadata = {
    rifleleagues_demo: true,
    demo_dataset: "development-demo-v1",
  };

  if (existing) {
    if (existing.app_metadata?.rifleleagues_demo !== true) {
      throw new Error(
        `Refusing to modify existing non-demo Auth account: ${demoUser.email}`,
      );
    }

    const { error } = await supabase.auth.admin.updateUserById(existing.id, {
      password: DEMO_PASSWORD,
      email_confirm: true,
      user_metadata: userMetadata,
      app_metadata: appMetadata,
    });

    if (error) throw error;
    refreshed += 1;
    continue;
  }

  const { error } = await supabase.auth.admin.createUser({
    email: demoUser.email,
    password: DEMO_PASSWORD,
    email_confirm: true,
    user_metadata: userMetadata,
    app_metadata: appMetadata,
  });

  if (error) {
    throw new Error(
      `Could not create ${demoUser.email}. Run database/user-profiles.sql first. ${error.message}`,
    );
  }

  created += 1;
}

console.log(
  `RifleLeagues demo Auth bootstrap complete: ${created} created, ${refreshed} refreshed.`,
);
console.log(`Shared demo password: ${DEMO_PASSWORD}`);
