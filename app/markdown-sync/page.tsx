import { redirect } from "next/navigation";

// The markdown screen became Documents; old links and bookmarks still work.
export default function MarkdownSyncPage() {
  redirect("/docs");
}
