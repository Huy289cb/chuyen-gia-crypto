/**
 * Date helper utilities
 */

/**
 * Format date to Vietnam timezone (GMT+7)
 * @param {Date|string} date - Date to format
 * @returns {string} Formatted date string in Vietnam timezone
 */
export function formatVietnamTime(date) {
  return new Date(date).toLocaleString('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}
