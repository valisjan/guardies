// Preserve controls and their listeners while patching a rendered view. Keys
// are local to each parent; changing the scope deliberately resets the view.
export function createKeyedRenderer(root) {
  const signatures = new WeakMap();
  const composing = new WeakSet();
  let scope;
  let lastHtml;
  root.addEventListener('compositionstart', (event) => composing.add(event.target));
  root.addEventListener('compositionend', (event) => {
    composing.delete(event.target);
    // A subtree deferred during IME composition must be reconsidered on the
    // next render, even if the model's HTML is unchanged.
    for (let node = event.target; node && node !== root; node = node.parentElement) signatures.delete(node);
    lastHtml = undefined;
  });

  function key(node) {
    if (node?.nodeType !== 1) return '';
    for (const attribute of ['data-coverage-session', 'data-coverage-row', 'data-comment', 'data-assignacio', 'data-pati-zone-override']) {
      if (node.hasAttribute(attribute)) return `${node.tagName}:${attribute}:${node.getAttribute(attribute)}`;
    }
    return '';
  }

  function compatible(a, b) {
    return a?.nodeType === b.nodeType && (b.nodeType !== 1 || a.tagName === b.tagName);
  }

  function remember(node) {
    if (node.nodeType !== 1) return;
    signatures.set(node, node.outerHTML);
    for (const child of node.children) remember(child);
  }

  function patchChildren(parent, incoming) {
    const previous = Array.from(parent.childNodes);
    const keyed = new Map(previous.filter((node) => key(node)).map((node) => [key(node), node]));
    const used = new Set();
    let cursor = parent.firstChild;
    for (const next of Array.from(incoming.childNodes)) {
      const nextKey = key(next);
      const current = nextKey ? keyed.get(nextKey)
        : !key(cursor) && compatible(cursor, next) ? cursor : null;
      const node = current && !used.has(current) && compatible(current, next) ? current : next.cloneNode(true);
      if (node !== cursor) parent.insertBefore(node, cursor);
      if (node === current) patch(node, next);
      else remember(node);
      used.add(node);
      cursor = node.nextSibling;
    }
    for (const node of previous) {
      if (!used.has(node)) node.remove();
    }
  }

  function patch(node, incoming) {
    if (node.nodeType !== 1) {
      if (node.nodeValue !== incoming.nodeValue) node.nodeValue = incoming.nodeValue;
      return;
    }
    const signature = incoming.outerHTML;
    if (signatures.get(node) === signature) return;
    const active = node.ownerDocument.activeElement === node;
    const liveValue = node.value;
    const selection = active && typeof node.selectionStart === 'number'
      ? [node.selectionStart, node.selectionEnd, node.selectionDirection] : null;
    for (const attribute of Array.from(node.attributes)) {
      if (!incoming.hasAttribute(attribute.name)) node.removeAttribute(attribute.name);
    }
    for (const attribute of Array.from(incoming.attributes)) {
      if (node.getAttribute(attribute.name) !== attribute.value) node.setAttribute(attribute.name, attribute.value);
    }
    if (!composing.has(node)) patchChildren(node, incoming);
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(node.tagName)) {
      // The day model trims observations. Do not trim the live editor (or
      // disturb its caret) when it already represents that same observation.
      const preserveEditor = active && node.tagName === 'TEXTAREA'
        && String(liveValue).trim() === incoming.value.trim();
      const value = preserveEditor || composing.has(node) ? liveValue : incoming.value;
      if (node.type !== 'file' && node.value !== value) node.value = value;
      if (node.tagName === 'INPUT') node.checked = incoming.checked;
      if (selection && !node.disabled) {
        node.setSelectionRange(Math.min(selection[0], node.value.length), Math.min(selection[1], node.value.length), selection[2]);
      }
    }
    signatures.set(node, signature);
  }

  return (html, nextScope) => {
    if (scope === nextScope && lastHtml === html) return;
    const template = root.ownerDocument.createElement('template');
    template.innerHTML = html;
    if (scope !== nextScope) {
      root.replaceChildren(template.content);
      for (const child of root.children) remember(child);
    } else {
      const active = root.ownerDocument.activeElement;
      const selection = root.contains(active) && typeof active.selectionStart === 'number'
        ? [active.selectionStart, active.selectionEnd, active.selectionDirection] : null;
      patchChildren(root, template.content);
      // Moving a keyed row can blur its editor even though it is not replaced.
      if (root.contains(active) && !active.disabled && root.ownerDocument.activeElement !== active) {
        active.focus({ preventScroll: true });
        if (selection) active.setSelectionRange(Math.min(selection[0], active.value.length), Math.min(selection[1], active.value.length), selection[2]);
      }
    }
    scope = nextScope;
    lastHtml = html;
  };
}
