import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";

const requireTs = createRequire(import.meta.url);
requireTs.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, fileName: filename,
}).outputText, filename);
const { signupEmailAvailable, signUpWithAvailableEmail, EmailAlreadyRegisteredError, isSignupEmail } = requireTs("../src/lib/signup-email.ts");

test("availability normalizes email, rejects invalid inputs and never fails open", async () => {
  const calls = [];
  const supabase = { rpc: (name, input) => { calls.push({ name, input }); return Promise.resolve({ data: true, error: null }); } };
  assert.equal(await signupEmailAvailable(supabase, " New@Example.com "), true);
  assert.deepEqual(calls, [{ name: "orms_signup_email_available", input: { p_email: "new@example.com" } }]);
  for (const email of ["", "bad", "x@y", "a b@example.com"]) { assert.equal(isSignupEmail(email), false); await assert.rejects(signupEmailAvailable(supabase, email), /valid email/); }
  assert.equal(calls.length, 1);
  for (const data of [null, {}, "true", 0]) {
    supabase.rpc = () => Promise.resolve({ data, error: null });
    await assert.rejects(signupEmailAvailable(supabase, "new@example.com"), /could not check/);
  }
  supabase.rpc = () => Promise.resolve({ error: { code: "email_check_rate_limit" } });
  await assert.rejects(signupEmailAvailable(supabase, "new@example.com"), /Wait a minute/);
  supabase.rpc = () => Promise.resolve({ error: { code: "unexpected", message: "private server detail" } });
  await assert.rejects(signupEmailAvailable(supabase, "new@example.com"), /could not check/);
});

test("an existing account is blocked before signup and no email is requested", async () => {
  let signups = 0;
  const supabase = { rpc: async () => ({ data: false, error: null }), auth: { signUp: async () => { signups++; } } };
  await assert.rejects(signUpWithAvailableEmail(supabase, "existing@example.com", "password", "https://orms.example/auth/confirm"), EmailAlreadyRegisteredError);
  assert.equal(signups, 0);
  supabase.rpc = async () => ({ error: { code: "network" } });
  await assert.rejects(signUpWithAvailableEmail(supabase, "existing@example.com", "password", "https://orms.example/auth/confirm"), /could not check/);
  assert.equal(signups, 0);
});

test("signup rechecks availability and rejects obfuscated duplicate responses from a race", async () => {
  const calls = [];
  const real = { data: { user: { id: "new-user", identities: [{ provider: "email" }] }, session: null }, error: null };
  const supabase = { rpc: async () => { calls.push("check"); return { data: true, error: null }; }, auth: { signUp: async input => { calls.push(input); return real; } } };
  assert.equal(await signUpWithAvailableEmail(supabase, " New@Example.com ", "password", "https://orms.example/auth/confirm?next=%2Fjoin%2Ftoken"), real);
  assert.deepEqual(calls, ["check", { email: "new@example.com", password: "password", options: { emailRedirectTo: "https://orms.example/auth/confirm?next=%2Fjoin%2Ftoken" } }]);
  supabase.auth.signUp = async () => ({ data: { user: { id: "fake-id", identities: [] }, session: null }, error: null });
  await assert.rejects(signUpWithAvailableEmail(supabase, "new@example.com", "password", "https://orms.example/auth/confirm"), EmailAlreadyRegisteredError);
  supabase.auth.signUp = async () => ({ data: {}, error: { code: "user_already_exists" } });
  await assert.rejects(signUpWithAvailableEmail(supabase, "new@example.com", "password", "https://orms.example/auth/confirm"), EmailAlreadyRegisteredError);
  supabase.auth.signUp = async () => ({ data: { user: null }, error: null });
  await assert.rejects(signUpWithAvailableEmail(supabase, "new@example.com", "password", "https://orms.example/auth/confirm"), /confirm account creation/);
  supabase.auth.signUp = async () => ({ data: { user: { id: "ambiguous" }, session: null }, error: null });
  await assert.rejects(signUpWithAvailableEmail(supabase, "new@example.com", "password", "https://orms.example/auth/confirm"), /confirm account creation/);
});
