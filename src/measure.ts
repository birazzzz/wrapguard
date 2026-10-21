export interface MeasureOptions {
  /** Elements whose text is measured. */
  selector: string;
  /** Elements (and their contents) that are never measured. */
  ignore: string[];
}

export interface MeasuredElement {
  /** Stable name for the element: `data-wrapguard` value or a short structural path. */
  key: string;
  /** Visible text, whitespace collapsed. */
  text: string;
  /** Number of lines the text takes on screen. */
  lines: number;
}

/**
 * Runs inside the page (via `page.evaluate`), so it must stay self-contained:
 * no imports and no references to anything outside this function.
 */
export function measureInPage(options: MeasureOptions): MeasuredElement[] {
  const ignoreSelector = ["[data-wrapguard-ignore]", ...options.ignore].join(",");
  // Tags kept in structural keys. Wrapper divs and spans come and go too often to be part of a name.
  const landmarkTags = new Set([
    "header", "footer", "main", "nav", "aside", "section", "article", "form",
    "dialog", "ul", "ol", "li", "table", "thead", "tbody", "tr", "dl", "fieldset",
  ]);
  const hiddenCache = new Map<Element, boolean>();

  const normalize = (text: string) => text.replace(/\s+/g, " ").trim();

  // Hidden for the purpose of wrapping: invisible, or squeezed into a 1px box the way
  // screen-reader-only text is. Such text would otherwise count one word per line.
  const isHidden = (el: Element): boolean => {
    const cached = hiddenCache.get(el);
    if (cached !== undefined) return cached;
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    const hidden =
      style.visibility === "hidden" ||
      style.visibility === "collapse" ||
      (style.position === "absolute" && style.clip !== "auto" && style.clip !== "") ||
      style.clipPath === "inset(50%)" ||
      ((rect.width <= 1 || rect.height <= 1) && style.overflow !== "visible");
    hiddenCache.set(el, hidden);
    return hidden;
  };

  const isHiddenWithin = (start: Element | null, root: Element): boolean => {
    for (let el = start; el; el = el.parentElement) {
      if (isHidden(el)) return true;
      if (el === root) break;
    }
    return false;
  };

  const displayCache = new Map<Element, string>();
  const displayOf = (el: Element): string => {
    let display = displayCache.get(el);
    if (display === undefined) {
      display = getComputedStyle(el).display;
      displayCache.set(el, display);
    }
    return display;
  };

  // The box that lays out a text node's lines: its nearest ancestor that isn't inline.
  const blockOf = (node: Node, root: Element): Element => {
    for (let el = node.parentElement; el && el !== root; el = el.parentElement) {
      const display = displayOf(el);
      if (display !== "inline" && display !== "contents") return el;
    }
    return root;
  };

  // Group text fragments into visual lines. A fragment joins the current line when its
  // vertical middle sits inside it, which keeps mixed font sizes on one line together.
  const linesIn = (rects: DOMRect[]): number => {
    rects.sort((a, b) => a.top - b.top);
    let lines = 0;
    let lineBottom = -Infinity;
    for (const rect of rects) {
      const middle = (rect.top + rect.bottom) / 2;
      if (lines > 0 && middle < lineBottom) {
        lineBottom = Math.max(lineBottom, rect.bottom);
      } else {
        lines++;
        lineBottom = rect.bottom;
      }
    }
    return lines;
  };

  const isInline = (el: Element) => {
    const display = displayOf(el);
    return display === "inline" || display === "contents";
  };

  const candidates = [...document.querySelectorAll(options.selector)].filter((el) => !el.closest(ignoreSelector));
  const candidateSet = new Set(candidates);
  const hasCandidateAncestor = (el: Element) => {
    for (let parent = el.parentElement; parent; parent = parent.parentElement) {
      if (candidateSet.has(parent)) return true;
    }
    return false;
  };

  // Each piece of text is measured once, by the element that owns it: `root`, unless a
  // block-level element that is measured itself (a heading inside a card link) sits in between.
  const ownsText = (node: Node, root: Element): boolean => {
    for (let el = node.parentElement; el; el = el.parentElement) {
      if (isHidden(el)) return false;
      if (el === root) return true;
      if (candidateSet.has(el) && !isInline(el)) return false;
    }
    return false;
  };

  const measure = (root: Element): { lines: number; text: string } => {
    const rectsByBlock = new Map<Element, DOMRect[]>();
    let text = "";
    let previousBlock: Element | undefined;
    const range = document.createRange();
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.nodeValue || !node.nodeValue.trim()) continue;
      if (node.parentElement?.closest(ignoreSelector) || !ownsText(node, root)) continue;
      range.selectNodeContents(node);
      const block = blockOf(node, root);
      let shown = false;
      for (const rect of range.getClientRects()) {
        if (rect.width <= 0.5 || rect.height <= 0) continue;
        shown = true;
        const rects = rectsByBlock.get(block);
        if (rects) rects.push(rect);
        else rectsByBlock.set(block, [rect]);
      }
      if (!shown) continue;
      // Frameworks split one sentence into several text nodes, so only separate blocks get a space.
      text += (previousBlock && previousBlock !== block ? " " : "") + node.nodeValue;
      previousBlock = block;
    }
    return { lines: countLines(rectsByBlock), text: normalize(text) };
  };

  const countLines = (rectsByBlock: Map<Element, DOMRect[]>): number => {

    // Blocks stacked on top of each other add up. Blocks side by side (a title with a
    // badge next to it) share their lines, so the taller one counts.
    const blocks = [...rectsByBlock.values()]
      .map((rects) => ({
        lines: linesIn(rects),
        top: Math.min(...rects.map((rect) => rect.top)),
        bottom: Math.max(...rects.map((rect) => rect.bottom)),
      }))
      .sort((a, b) => a.top - b.top);
    let total = 0;
    let group: { lines: number; top: number; bottom: number } | undefined;
    for (const block of blocks) {
      const overlap = group ? Math.min(group.bottom, block.bottom) - Math.max(group.top, block.top) : 0;
      const smaller = group ? Math.min(group.bottom - group.top, block.bottom - block.top) : 0;
      if (group && overlap >= smaller / 2) {
        group.lines = Math.max(group.lines, block.lines);
        group.bottom = Math.max(group.bottom, block.bottom);
      } else {
        if (group) total += group.lines;
        group = { ...block };
      }
    }
    return total + (group?.lines ?? 0);
  };

  // Ids made by React, Radix, Headless UI and friends change between builds.
  const isStableId = (id: string) =>
    /^[A-Za-z][\w-]*$/.test(id) && !/^(radix|headlessui|react|mui|chakra|mantine)-/i.test(id);

  const isLandmark = (el: Element) => landmarkTags.has(el.localName);

  // 1-based position among same-tag elements that share the same nearest landmark.
  const indexCache = new Map<Element, number>();
  const nearestLandmark = (el: Element): Element | null => {
    for (let parent = el.parentElement; parent; parent = parent.parentElement) {
      if (parent.hasAttribute("data-wrapguard") || (parent.id && isStableId(parent.id))) return parent;
      if (isLandmark(parent) || parent === document.body) return parent;
    }
    return null;
  };
  const indexOf = (el: Element): number => {
    const cached = indexCache.get(el);
    if (cached !== undefined) return cached;
    const scope = nearestLandmark(el) ?? document.body;
    let index = 0;
    for (const candidate of scope.querySelectorAll(el.localName)) {
      if (nearestLandmark(candidate) !== scope) continue;
      index++;
      indexCache.set(candidate, index);
    }
    return indexCache.get(el) ?? 1;
  };

  const segment = (el: Element): string => {
    const index = indexOf(el);
    return index > 1 ? `${el.localName}[${index}]` : el.localName;
  };

  const keyFor = (el: Element): string => {
    const named = el.getAttribute("data-wrapguard");
    if (named) return named;
    if (el.id && isStableId(el.id)) return `#${el.id}`;
    const parts = [segment(el)];
    for (let parent = el.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
      const parentName = parent.getAttribute("data-wrapguard");
      if (parentName) {
        parts.unshift(parentName);
        break;
      }
      if (parent.id && isStableId(parent.id)) {
        parts.unshift(`#${parent.id}`);
        break;
      }
      if (isLandmark(parent)) parts.unshift(segment(parent));
    }
    return parts.join(" > ");
  };

  const results: MeasuredElement[] = [];
  const usedKeys = new Map<string, number>();

  for (const el of candidates) {
    // A link inside a paragraph or list item is part of that element's lines.
    if (isInline(el) && hasCandidateAncestor(el)) continue;
    if (isHiddenWithin(el.parentElement, document.documentElement)) continue;
    const { lines, text } = measure(el);
    if (lines === 0 || !text) continue;

    let key = keyFor(el);
    const seen = usedKeys.get(key) ?? 0;
    usedKeys.set(key, seen + 1);
    if (seen > 0) key = `${key} ~${seen + 1}`;

    results.push({ key, text, lines });
  }
  return results;
}
