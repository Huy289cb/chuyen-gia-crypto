"use strict";
/**
 * Date helper utilities
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatVietnamTime = formatVietnamTime;
/**
 * Format date to Vietnam timezone (GMT+7)
 * @param {Date|string} date - Date to format
 * @returns {string} Formatted date string in Vietnam timezone
 */
function formatVietnamTime(date) {
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
//# sourceMappingURL=dateHelpers.js.map