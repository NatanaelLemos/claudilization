const banner = document.getElementById("banner")!;
let timer: ReturnType<typeof setTimeout> | undefined;

/** World moments sweep in top-center and fade — the page's one loud element. */
export function showBanner(text: string): void {
  banner.textContent = text;
  banner.hidden = false;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    banner.hidden = true;
  }, 8000);
}
