/**
 * Every copy button goes through here. In the desktop app the app itself
 * writes the clipboard (the page's own access is refused there, and fails as
 * soon as the window loses focus); in a browser, the Clipboard API, and the
 * old selection trick when that is refused.
 */
export async function copyText(text: string): Promise<void> {
  const desktop = (window as unknown as { repoboardDesktop?: { copy?: (text: string) => Promise<boolean> } }).repoboardDesktop;
  if (desktop?.copy && (await desktop.copy(text).catch(() => false))) return;
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    // Refused or unavailable: try the selection below.
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  const ok = document.execCommand("copy");
  area.remove();
  if (!ok) throw new Error("The clipboard refused");
}
