import { redirect } from "next/navigation";
import { authenticatedAccount } from "@/lib/security";
import { adminSummary } from "@/lib/account-admin";
import AdminPanel from "@/components/admin-panel";
export const dynamic = "force-dynamic";
export default async function AdminPage() {
  const user = await authenticatedAccount();
  if (!user) redirect("/admin/login");
  if (user.role !== "admin") redirect("/");
  return <AdminPanel initial={await adminSummary(user.id)} name={user.name} />;
}
