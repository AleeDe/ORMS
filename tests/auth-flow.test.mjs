import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";

const requireTs = createRequire(import.meta.url);
requireTs.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename,"utf8"), { compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020},fileName:filename }).outputText, filename);
const { passwordResetDestination, isRecoveryToken, authFlowError, requestPasswordReset, verifySignupCode } = requireTs("../src/lib/auth-flow.ts");

test("password recovery retains campaign invitation context through nested email redirects", () => {
  const next = "/join/" + "a".repeat(64);
  assert.equal(passwordResetDestination(next), next);
  assert.equal(passwordResetDestination(`https://shiftorms.netlify.app/auth/reset-password?next=${encodeURIComponent(next)}`), next);
  assert.equal(passwordResetDestination("https://shiftorms.netlify.app/auth/confirm?next=%2Flogin%2Fupdate-password"), "/");
  for (const value of [undefined, [], "//evil.example", "/\\evil.example", "https://evil.example/account", "/auth/confirm?code=loop", "/login/update-password"]) assert.equal(passwordResetDestination(value), "/");
});

test("reset requests send users to the scanner-safe form and normalize the recipient", async () => {
  const requests=[];
  const auth={resetPasswordForEmail:async(...args)=>{requests.push(args);return{error:null};}};
  await requestPasswordReset(auth," Person@Example.com ","https://shiftorms.netlify.app","/join/invite");
  assert.deepEqual(requests,[["person@example.com",{redirectTo:"https://shiftorms.netlify.app/auth/reset-password?next=%2Fjoin%2Finvite"}]]);
  auth.resetPasswordForEmail=async()=>{throw Error("Network unavailable");};
  await assert.rejects(requestPasswordReset(auth,"person@example.com","https://orms.example","/"),/Network unavailable/);
});

test("signup codes verify the email on any browser without requiring a local PKCE verifier", async () => {
  const calls=[];
  const auth={verifyOtp:async input=>{calls.push(input);return{error:null,data:{session:{}}};}};
  await verifySignupCode(auth," Person@Example.com ","12 34-5678");
  assert.deepEqual(calls,[{email:"person@example.com",token:"12345678",type:"email"}]);
  for(const code of ["", "123", "12345678901", "abcdef", "12345a78"]) assert.throws(()=>verifySignupCode(auth,"person@example.com",code),/verification code/);
  assert.equal(calls.length,1);
});

test("recovery tokens reject malformed inputs and auth failures provide useful retry guidance", () => {
  assert(isRecoveryToken("a".repeat(64)));
  assert(isRecoveryToken("pkce_"+"b".repeat(64)));
  for(const value of [undefined,{},[],"short","a b".repeat(20)]) assert.equal(isRecoveryToken(value),false);
  assert.match(authFlowError({code:"otp_expired"}),/Request a new/);
  assert.match(authFlowError({code:"over_email_send_rate_limit"}),/wait a minute/);
  assert.equal(authFlowError(null),"We could not connect. Please try again.");
});
