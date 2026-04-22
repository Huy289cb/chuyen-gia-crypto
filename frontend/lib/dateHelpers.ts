/**
 * Convert UTC timestamp to Vietnam time (GMT+7)
 * @param timestamp - UTC timestamp string or null
 * @param fallbackTimestamp - Fallback timestamp if primary is null (e.g., executed_at)
 * @returns Formatted date string in Vietnam time or 'N/A' if both are null
 */
export function formatToGMT7(
  timestamp: string | null | undefined,
  fallbackTimestamp?: string | null | undefined
): string {
  const ts = timestamp || fallbackTimestamp;
  if (!ts) return 'N/A';

  try {
    const date = new Date(ts);
    // Use timeZone option to convert UTC to GMT+7 (Asia/Ho_Chi_Minh)
    return date.toLocaleString('vi-VN', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      timeZone: 'Asia/Ho_Chi_Minh'
    });
  } catch (error) {
    console.error('Error formatting timestamp:', error);
    return 'Invalid Date';
  }
}
