/**
 * 写入 MySQL `DATETIME` 时使用东八区墙上时钟（与 Asia/Shanghai 一致，无夏令时）。
 * 避免驱动将 `Date` 按 UTC 序列化导致入库少 8 小时。
 */
export function formatMysqlDateTimeShanghai(date: Date = new Date()): string {
  return date.toLocaleString("sv-SE", {
    hour12: false,
    timeZone: "Asia/Shanghai",
  });
}
