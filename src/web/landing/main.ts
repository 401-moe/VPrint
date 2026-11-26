import { setupPageMotion, setupPrintDemo } from "./motion";

const root = document.querySelector<HTMLElement>(".landing")!;
const disposeMotion = setupPageMotion(root);
const disposePrint = setupPrintDemo(root.querySelector<HTMLElement>(".try-panel")!);
const events = new AbortController();
const timers = new Set<number>();

for (const command of root.querySelectorAll<HTMLElement>(".command")) {
  const button = command.querySelector<HTMLButtonElement>("button")!;
  const code = command.querySelector<HTMLElement>("code")!;
  const status = command.querySelector<HTMLElement>('[role="status"]')!;
  const icon = button.querySelector<SVGElement>("svg")!;
  const copyIcon = icon.innerHTML;
  const label = button.getAttribute("aria-label")!;
  const value = code.textContent!.trim().replace(/^\$\s*/, "");
  let timer: number | undefined;
  button.disabled = false;
  button.addEventListener("click", async () => {
    button.disabled = true;
    if (timer !== undefined) {
      clearTimeout(timer);
      timers.delete(timer);
    }
    try {
      await navigator.clipboard.writeText(value);
      if (events.signal.aborted) return;
      status.textContent = "已复制命令";
      button.setAttribute("aria-label", `已复制 ${value}`);
      icon.innerHTML = '<path d="m20 6-11 11-5-5"></path>';
    } catch {
      status.textContent = "复制失败，请选中命令手动复制";
    } finally {
      button.disabled = false;
    }
    timer = window.setTimeout(() => {
      status.textContent = "";
      button.setAttribute("aria-label", label);
      icon.innerHTML = copyIcon;
      timers.delete(timer!);
    }, 1800);
    timers.add(timer);
  }, { signal: events.signal });
  button.hidden = false;
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    events.abort();
    timers.forEach(clearTimeout);
    root.querySelectorAll<HTMLButtonElement>(".command button").forEach(button => { button.hidden = true; });
    disposeMotion();
    disposePrint();
  });
}
