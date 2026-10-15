import { redirect } from "next/navigation";
import { hasOwner, isAuthenticated } from "@/lib/security";
import LoginForm from "@/components/login-form";
export const dynamic = "force-dynamic";
export default async function Login() {
  if (await isAuthenticated()) redirect("/");
  return <LoginForm setup={!(await hasOwner())} />;
}
