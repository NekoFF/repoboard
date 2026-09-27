import { redirect } from "next/navigation";

/** The sidebar calls the screen "Code"; its address is /repository. */
export default function CodePage() {
  redirect("/repository");
}
