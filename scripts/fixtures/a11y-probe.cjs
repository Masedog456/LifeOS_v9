/**
 * LIFEOS-099 §4 — the measurement primitives, in one place.
 *
 * Shared by the audit probes and by scripts/smoke-099-accessibility.cjs, so an
 * assertion and the number that justified it are computed the same way.
 *
 * Every number this sprint reports comes through here, so a probe and the
 * assertion that pins it cannot disagree about how a ratio was computed.
 *
 * The colour rule is the one LIFEOS-098 got wrong first: computed styles on
 * this project come back as `lab(...)`, and parsing the three components as RGB
 * reported every dark-mode phrase at 1.06 — a probe bug that would have been
 * filed as an invisible-text defect. The canvas does the conversion exactly,
 * whatever colour space the value is written in, and it also resolves
 * `oklch()`, `color-mix()` and CSS variables for free because the browser has
 * already resolved them by the time `getComputedStyle` returns.
 *
 * Opacity and translucent backgrounds are handled by COMPOSITING rather than by
 * reading one declaration: `effectiveColor` walks up the tree alpha-blending
 * every background it finds until it reaches an opaque one, and multiplies in
 * every inherited `opacity` on the way.
 */

/** Injected into the page. Returns a function-shaped string for `evaluate`. */
const PROBE = /* js */ `
(() => {
  const cv = document.createElement("canvas");
  cv.width = cv.height = 1;
  const cx = cv.getContext("2d", { willReadFrequently: true });

  /** Any CSS colour -> [r,g,b,a] in sRGB bytes, via the browser's own parser. */
  function parse(c) {
    if (!c) return [0, 0, 0, 0];
    cx.clearRect(0, 0, 1, 1);
    cx.globalCompositeOperation = "copy";
    cx.fillStyle = "rgba(0,0,0,0)";
    cx.fillStyle = c;                       // invalid values keep the previous
    cx.fillRect(0, 0, 1, 1);
    const d = cx.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2], d[3] / 255];
  }

  /** Alpha-composite fg over bg. Both [r,g,b,a]; returns an opaque triple. */
  function over(fg, bg) {
    const a = fg[3];
    return [0, 1, 2].map((i) => Math.round(fg[i] * a + bg[i] * (1 - a)));
  }

  function relLum(rgb) {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
  }

  /** The page's own ground, for the last step of the composite walk. */
  function pageGround() {
    for (const e of [document.body, document.documentElement]) {
      const c = parse(getComputedStyle(e).backgroundColor);
      if (c[3] >= 0.999) return [c[0], c[1], c[2]];
    }
    return getComputedStyle(document.documentElement).colorScheme === "dark"
      ? [0, 0, 0] : [255, 255, 255];
  }

  /**
   * The colour actually painted behind an element's TEXT, composited.
   *
   * The walk starts at the element itself, not its parent. A button paints its
   * own background and its own label, so starting at the parent reported white
   * text on the page ground — a 1.00 ratio for every primary button, which is
   * the second probe bug this project has produced and would have been filed as
   * a catastrophic defect.
   */
  function bgOf(el) {
    const layers = [];
    for (let e = el; e; e = e.parentElement) {
      const c = parse(getComputedStyle(e).backgroundColor);
      if (c[3] > 0.001) {
        layers.push(c);
        if (c[3] >= 0.999) break;
      }
    }
    let out = pageGround();
    for (let i = layers.length - 1; i >= 0; i--) out = over(layers[i], out);
    return out;
  }

  /** Cumulative opacity from ancestors, which fades text without changing its colour. */
  function effectiveAlpha(el) {
    let a = 1;
    for (let e = el; e; e = e.parentElement) {
      const o = parseFloat(getComputedStyle(e).opacity);
      if (!Number.isNaN(o)) a *= o;
    }
    return a;
  }

  /**
   * Is this text inside a DISABLED control? (§33)
   *
   * Worth separating rather than counting as a failure: the primary Capture
   * button is opacity 0.3 until the field has content, and reporting its
   * 2.70 beside a metadata failure would conflate "faded on purpose, and the
   * fading IS the signal" with "faint by accident". §33 asks that disabled text
   * stay identifiable, which is a different threshold from AA.
   */
  function isDisabled(el) {
    for (let e = el; e; e = e.parentElement) {
      if (e.disabled === true) return true;
      if (e.getAttribute && e.getAttribute("aria-disabled") === "true") return true;
    }
    return false;
  }

  /** WCAG contrast of an element's text against what is really behind it. */
  function contrastOf(el) {
    const st = getComputedStyle(el);
    const bg = bgOf(el);
    const fgRaw = parse(st.color);
    const alpha = fgRaw[3] * effectiveAlpha(el);
    const fg = over([fgRaw[0], fgRaw[1], fgRaw[2], alpha], bg);
    const L1 = relLum(fg), L2 = relLum(bg);
    return {
      ratio: (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05),
      fg: "rgb(" + fg.join(",") + ")",
      bg: "rgb(" + bg.join(",") + ")",
      px: parseFloat(st.fontSize),
      weight: st.fontWeight,
      alpha: Math.round(alpha * 100) / 100,
      disabled: isDisabled(el),
    };
  }

  /** WCAG AA for this size: 3:1 once text is 18.66px bold or 24px. */
  function required(px, weight) {
    const bold = parseInt(weight, 10) >= 700;
    return (px >= 24 || (bold && px >= 18.66)) ? 3 : 4.5;
  }

  /** Leaf elements that actually paint text. */
  function textLeaves(root) {
    const out = [];
    for (const el of (root || document).querySelectorAll("*")) {
      if (!el.firstChild) continue;
      let own = "";
      for (const n of el.childNodes) if (n.nodeType === 3) own += n.nodeValue;
      own = own.trim();
      if (!own) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      const st = getComputedStyle(el);
      if (st.visibility === "hidden" || st.display === "none") continue;
      out.push({ el, text: own });
    }
    return out;
  }

  /** A short, stable identifier for a style, so repeats can be counted (§N). */
  function styleKey(el) {
    const st = getComputedStyle(el);
    const cls = (el.className || "").toString();
    const tok = cls.split(/\\s+/).filter((c) => /^(text-|opacity-|font-)/.test(c)).sort().join(" ");
    return (tok || "(no token)") + " @" + st.fontSize;
  }

  const SELECTOR_INTERACTIVE =
    'a[href],button,input,select,textarea,summary,[role="button"],[role="link"],' +
    '[role="option"],[role="menuitem"],[role="tab"],[tabindex]:not([tabindex="-1"])';

  /** The accessible name, computed the way a screen reader would (§22). */
  function accName(el) {
    const lbl = el.getAttribute("aria-label");
    if (lbl && lbl.trim()) return lbl.trim();
    const by = el.getAttribute("aria-labelledby");
    if (by) {
      const t = by.split(/\\s+/).map((id) => document.getElementById(id))
        .filter(Boolean).map((n) => n.textContent.trim()).join(" ").trim();
      if (t) return t;
    }
    if (el.id) {
      const l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
      if (l && l.textContent.trim()) return l.textContent.trim();
    }
    const wrap = el.closest("label");
    if (wrap && wrap.textContent.trim()) return wrap.textContent.trim();
    const t = (el.textContent || "").trim();
    if (t) return t;
    const title = el.getAttribute("title");
    if (title && title.trim()) return title.trim();
    const alt = el.querySelector("img[alt]");
    if (alt && alt.getAttribute("alt").trim()) return alt.getAttribute("alt").trim();
    return "";
  }

  window.__a11y = {
    parse, relLum, contrastOf, required, textLeaves, styleKey, accName, bgOf, pageGround, isDisabled,
    SELECTOR_INTERACTIVE,
  };
  return true;
})()
`;

/** Install the probe into a page (call after every navigation). */
async function install(page) {
  await page.evaluate(PROBE);
}

const BASE = process.env.BASE || "http://localhost:3111";
const KEY = "lifeos.mvp.v1";
const EXEC = process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

/** The nine scoped surfaces (§2). `/actions/a-long` stands in for action detail. */
const SURFACES = [
  ["home", "/"],
  ["today", "/today"],
  ["decisions", "/today/decisions"],
  ["action", "/actions/a-long"],
  ["project", "/project/p1"],
  ["goal", "/goal/g1"],
  ["evening", "/today/review"],
  ["week", "/memory"],
];

module.exports = { PROBE, install, BASE, KEY, EXEC, SURFACES };
