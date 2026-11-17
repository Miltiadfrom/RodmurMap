// Ограничивает область действия CSS генератора одним поддеревом, чтобы стили карты
// не протекали в интерфейс атласа.

const ROOT_PROPERTIES = /^(--|fill-rule$|stroke-linecap$|stroke-linejoin$|font-family$|font-size$|color$|text-rendering$|shape-rendering$)/;

export function scopeCss(css, scope) {
  let out = "";
  let i = 0;
  while (i < css.length) {
    const brace = css.indexOf("{", i);
    if (brace < 0) break;
    const prelude = css.slice(i, brace).trim();
    let depth = 1;
    let j = brace + 1;
    while (j < css.length && depth > 0) {
      if (css[j] === "{") depth++;
      else if (css[j] === "}") depth--;
      j++;
    }
    const body = css.slice(brace + 1, j - 1);
    if (prelude.startsWith("@")) {
      if (/^@(media|supports|layer|container)/.test(prelude)) out += `${prelude}{${scopeCss(body, scope)}}`;
      else if (/^@keyframes/.test(prelude)) out += `${prelude}{${body}}`;
      // @font-face и @import не нужны: подписи генератора мы не используем
    } else if (prelude) {
      const selectors = prelude
        .split(",")
        .map(part => part.trim())
        .filter(Boolean)
        .map(part => {
          const replaced = part.replace(/#map\b/g, scope).replace(/:root\b/g, scope);
          if (replaced === scope || replaced.startsWith(`${scope} `) || replaced.startsWith(`${scope}>`)) return replaced;
          if (/^(html|body)\b/.test(replaced)) return scope;
          return `${scope} ${replaced}`;
        });
      // Правила самого корня (#map, html, body) описывают окно генератора: скрытие до загрузки,
      // позиционирование, фон. Для вставленной подложки годятся только наследуемые свойства рисования.
      const root = selectors.filter(part => part === scope);
      const rest = selectors.filter(part => part !== scope);
      if (root.length) {
        const kept = body
          .split(";")
          .map(decl => decl.trim())
          .filter(decl => ROOT_PROPERTIES.test(decl.split(":")[0].trim()))
          .join("; ");
        if (kept) out += `${scope}{${kept}}`;
      }
      if (rest.length) out += `${rest.join(",")}{${body}}`;
    }
    i = j;
  }
  return out;
}
