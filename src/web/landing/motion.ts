import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";

export function setupPageMotion(root: HTMLElement) {
  gsap.registerPlugin(ScrollTrigger, SplitText);
  const media = gsap.matchMedia();

  media.add("(prefers-reduced-motion: no-preference)", () => {
    const titles = Array.from(root.querySelectorAll<HTMLElement>(".start-title-line"), line =>
      SplitText.create(line, { type: "lines", mask: "lines", aria: "auto" }),
    );
    gsap.timeline({ defaults: { ease: "power3.out", duration: 0.65 } })
      .from(titles[0].lines, { yPercent: 105, duration: 0.8 }, 0)
      .from(titles[1].lines, { yPercent: 105, duration: 0.8 }, 0.1)
      .from(".start-hero-copy .eyebrow", { opacity: 0, y: 6, duration: 0.4 }, 0.1)
      .from(".start-hero-copy .lead", { opacity: 0, y: 12 }, 0.26)
      .from(".start-hero-actions", { opacity: 0, y: 8, duration: 0.5 }, 0.36)
      .from(".start-demo-intro", { opacity: 0, y: 18, duration: 0.65 }, 0.1);

    const guide = root.querySelector<HTMLElement>(".start-guide")!;
    const guideTitle = SplitText.create(guide.querySelector("h2")!, {
      type: "lines", mask: "lines", autoSplit: true,
      onSplit(self) {
        return gsap.from(self.lines, {
          yPercent: 105, duration: 0.75, stagger: 0.08, ease: "power3.out",
          scrollTrigger: { trigger: guide, start: "top 82%", once: true },
        });
      },
    });
    gsap.timeline({ scrollTrigger: { trigger: guide, start: "top 78%", once: true }, defaults: { ease: "power3.out" } })
      .from(".guide-steps li", { x: 24, opacity: 0, stagger: 0.09, duration: 0.65 }, 0.08)
      .from(".guide-intro > p:not(.eyebrow), .guide-actions, .platforms", { y: 10, opacity: 0, stagger: 0.06, duration: 0.6 }, 0.14);
    gsap.from(".lp-footer > *", {
      y: 8, opacity: 0, duration: 0.55, stagger: 0.06, ease: "power3.out",
      scrollTrigger: { trigger: ".lp-footer", start: "top 96%", once: true },
    });
    return () => {
      titles.forEach(title => title.revert());
      guideTitle.revert();
    };
  }, root);

  media.add({ desktop: "(min-width: 800px)", mobile: "(max-width: 799px)", pinned: "(min-width: 800px) and (min-height: 721px)", reduce: "(prefers-reduced-motion: reduce)" }, context => {
    const { desktop, pinned, reduce } = context.conditions!;
    if (reduce) return;
    if (pinned) {
      gsap.set(".start-reading-story", { height: 1040 });
      gsap.set(".story-sticky", { position: "sticky", top: 20 });
    }
    gsap.timeline({
      defaults: { ease: "none", duration: 1 },
      scrollTrigger: {
        trigger: ".start-reading-story", start: desktop ? "top 48%" : "top 76%",
        end: desktop ? "bottom 90%" : "bottom 85%", scrub: true, invalidateOnRefresh: true,
      },
    })
      .fromTo(".spread-desktop", { y: desktop ? 74 : 28, rotationX: desktop ? 22 : 0, rotationY: desktop ? -13 : 0, scale: desktop ? 0.89 : 0.96 }, { y: 0, rotationX: 0, rotationY: 0, scale: 1 }, 0)
      .fromTo(".spread-phone", { x: desktop ? -220 : -60, y: desktop ? 55 : 35, rotation: desktop ? -15 : -9, scale: 0.92 }, { x: 0, y: 0, rotation: 0, scale: 1 }, 0)
      .fromTo(".spread-terminal", { x: desktop ? 175 : 20, y: desktop ? 60 : 15, rotation: desktop ? 8 : 0 }, { x: 0, y: 0, rotation: 0 }, 0)
      .fromTo(".story-ink", { opacity: 0.3 }, { opacity: 1, duration: 0.6 }, 0)
      .fromTo(".story-route span", { scaleX: 0 }, { scaleX: 1 }, 0)
      .fromTo(".spread-notice", { opacity: 0, y: 22, scale: 0.96 }, { opacity: 1, y: 0, scale: 1, duration: 0.22 }, 0.7);
  }, root);

  return () => media.revert();
}

export function setupPrintDemo(panel: HTMLElement) {
  const empty = panel.querySelector<HTMLElement>(".try-empty")!;
  const paper = panel.querySelector<HTMLElement>(".try-received")!;
  const destination = panel.querySelector<HTMLElement>(".try-receiver-body")!;
  const command = panel.querySelector<HTMLElement>(".demo-command")!;
  const button = panel.querySelector<HTMLButtonElement>(".demo-run")!;
  const status = panel.querySelector<HTMLElement>("[data-print-status]")!;
  const check = panel.querySelector<SVGElement>(".delivery-check")!;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  const events = new AbortController();
  const context = gsap.context(() => {}, panel);
  let landed = false;
  let timeline: gsap.core.Timeline | null = null;

  function setPhase(phase: "idle" | "sending" | "received") {
    panel.dataset.phase = phase;
    button.disabled = phase === "sending";
    paper.inert = phase !== "received";
    paper.setAttribute("aria-hidden", String(phase !== "received"));
    empty.setAttribute("aria-hidden", String(phase !== "idle"));
    check.toggleAttribute("hidden", phase !== "received");
    status.textContent = phase === "sending" ? "正在传递" : phase === "received" ? "已送达" : "待接收";
  }

  function finish() {
    timeline?.kill();
    gsap.set(empty, { autoAlpha: 0 });
    gsap.set(paper, { x: 0, y: 0, scale: 1, rotation: 0, autoAlpha: 1 });
    landed = true;
    setPhase("received");
  }

  button.addEventListener("click", event => {
    if (timeline?.isActive()) return;
    context.add(() => {
      if (event.detail === 0 || reduced.matches) { finish(); return; }
      setPhase("sending");
      const source = command.getBoundingClientRect();
      const target = destination.getBoundingClientRect();
      // This single printout travels all the way into the reading area.
      const start = {
        x: source.left + source.width / 2 - target.left - target.width / 2,
        y: source.top + source.height / 2 - target.top - target.height / 2,
        scale: 0.46, rotation: -2, autoAlpha: 0,
      };
      timeline = gsap.timeline({ onComplete: () => { context.add(finish); } });
      if (landed) timeline.to(paper, { autoAlpha: 0, y: 12, duration: 0.16, ease: "power2.in" });
      timeline.addLabel("send")
        .set(paper, { ...start, transformOrigin: "center" }, "send")
        .to(empty, { autoAlpha: 0, duration: 0.16 }, "send")
        .to(paper, { autoAlpha: 1, duration: 0.16, ease: "none" }, "send")
        .to(paper, { x: 0, y: 0, scale: 1, rotation: 0, duration: 0.9, ease: "power2.inOut" }, "send");
    });
  }, { signal: events.signal });

  const settle = () => { if (timeline?.isActive()) context.add(finish); };
  window.addEventListener("resize", settle, { signal: events.signal });
  reduced.addEventListener("change", settle, { signal: events.signal });
  setPhase("idle");

  return () => {
    events.abort();
    context.revert();
    delete panel.dataset.phase;
    paper.inert = false;
    paper.removeAttribute("aria-hidden");
  };
}
