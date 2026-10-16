import { redirect } from "next/navigation";
import { authenticatedAccount, hasOwner } from "@/lib/security";
import LoginForm from "@/components/login-form";
export const dynamic = "force-dynamic";
export default async function AdminLogin() {
  const user = await authenticatedAccount();
  if (user) redirect(user.role === "admin" ? "/admin" : "/");
  return <LoginForm setup={!(await hasOwner())} admin />;
}
