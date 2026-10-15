import { redirect } from "next/navigation";
import { isAuthenticated } from "@/lib/security";
import { state } from "@/lib/service";
import Workspace from "@/components/workspace";
export const dynamic = "force-dynamic";
export default async function Home() {
  if (!(await isAuthenticated())) redirect("/login");
  return <Workspace initialState={state()} />;
}
