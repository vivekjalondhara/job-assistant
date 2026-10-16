import * as nodeTest from "node:test";
import { withUser, LEGACY_USER_ID, query } from "../src/lib/db";
export { after, afterEach } from "node:test";
const isSetupTest = (name: string) =>
  name.startsWith("private data requires") || name.includes("concurrent owner setup");
type Callback = (context: nodeTest.TestContext) => unknown;
export function test(name: string, optionsOrFn: nodeTest.TestOptions | Callback, fn?: Callback) {
  const callback = typeof optionsOrFn === "function" ? optionsOrFn : fn!;
  return nodeTest.test(
    name,
    typeof optionsOrFn === "function" ? {} : optionsOrFn,
    async (context) => {
      await (isSetupTest(name)
        ? callback(context)
        : withUser(LEGACY_USER_ID, () => callback(context)));
    },
  );
}
export function beforeEach(fn: (context: nodeTest.TestContext | nodeTest.SuiteContext) => unknown) {
  return nodeTest.beforeEach(async (context) => {
    await query(
      "DELETE FROM folio_account_tokens; DELETE FROM folio_accounts; DELETE FROM folio_login_rates;",
    );
    if (!isSetupTest(context.name))
      await query(
        `INSERT INTO folio_accounts(id,name,role,status,created_at) VALUES($1,'Test owner','admin','active',$2)`,
        [LEGACY_USER_ID, new Date().toISOString()],
      );
    await (isSetupTest(context.name) ? fn(context) : withUser(LEGACY_USER_ID, () => fn(context)));
  });
}
