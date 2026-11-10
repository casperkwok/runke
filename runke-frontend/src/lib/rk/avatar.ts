/* 头像生成（移植自 Runke产品原型/data.jsx）：离线、确定性的渐变 SVG data URI。 */
function hash(s: string): number {
  let h = 0;
  for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) % 100000;
  return h;
}

export function avatarDataUri(seed: string): string {
  const h = hash(seed) % 360;
  const h2 = (h + 38) % 360;
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='96' height='96'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='hsl(${h} 68% 64%)'/><stop offset='1' stop-color='hsl(${h2} 64% 54%)'/></linearGradient></defs><rect width='96' height='96' fill='url(#g)'/><circle cx='48' cy='39' r='16' fill='#fff' fill-opacity='.94'/><path d='M22 84a26 24 0 0 1 52 0z' fill='#fff' fill-opacity='.94'/></svg>`;
  return "data:image/svg+xml;utf8," + encodeURIComponent(svg);
}

export const av = (seed: string) => avatarDataUri(seed);
export const realAv = (id: number | string, g: "women" | "men" = "women") =>
  avatarDataUri(`${g}-${id}`);

/** 为一个 bot 生成稳定头像：优先用其 avatar 字段，否则按 id 生成。 */
export const botAvatar = (bot: { avatar?: string; id: string }) =>
  bot.avatar || avatarDataUri(bot.id);
