// 按保存顺序逐张找最靠上、最靠左的空位；只计算坐标，不改数组或 DOM 顺序。
export function packWidgets(items, gap = 14) {
  const placed = [];
  for (const item of items) {
    const width = item.size === 'small' ? 1 : 2;
    const height = Math.max(1, Math.ceil(item.height));
    const levels = [...new Set([0, ...placed.map(p => p.y + p.height + gap)])].sort((a, b) => a - b);
    let position;
    for (const y of levels) {
      for (let x = 0; x <= 3 - width; x++) {
        if (placed.every(p => x + width <= p.x || x >= p.x + p.width || y >= p.y + p.height + gap || y + height + gap <= p.y)) {
          position = { id: item.id, x, y, width, height };
          break;
        }
      }
      if (position) break;
    }
    placed.push(position);
  }
  return placed;
}
