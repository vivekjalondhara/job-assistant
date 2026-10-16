import { redirect } from "next/navigation";
import { authenticatedAccount } from "@/lib/security";
import { state } from "@/lib/service";
import { withUser } from "@/lib/db";
import Workspace from "@/components/workspace";
export const dynamic = "force-dynamic";
export default async function Home() {
  const user = await authenticatedAccount();
  if (!user) redirect("/login");
  return <Workspace initialState={await withUser(user.id, state)} />;
}
