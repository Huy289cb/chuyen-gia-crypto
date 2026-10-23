# Đồng bộ giới hạn TP trong bộ sửa mức giá

Vấn đề: nhánh sửa SL đã chặn TP vượt mục tiêu gốc, nhưng nhánh sửa RR-only giữ entry/SL rồi yêu cầu AI kéo TP để đủ RR. Điều này có thể đưa kế hoạch chưa đạt RR qua bằng mục tiêu xa hơn mà chưa có phân tích cấu trúc mới.

Thay đổi: RR-only giữ no_trade khi RR gốc chưa đạt; không gọi AI để dời mục tiêu. Với SL dưới floor, tính khả năng đáp ứng floor + RR trong giới hạn TP gốc trước khi gọi AI. Nếu khả thi, AI vẫn được đề xuất SL/TP và kết quả được kiểm tra lại trong giới hạn cũ. Prompt bổ sung giới hạn TP rõ ràng.

13 kiểm thử/3 file đạt: chặn hai hướng trước API với mức không khả thi, giữ sửa SL khả thi hai hướng, từ chối AI trả TP vượt bound; hồi quy prompt và cache dispatch đạt. Bản code chỉ thay module levels adapter; không đổi cấu hình 1h/10%/3% hoặc ngưỡng chiến lược.

Đây là sửa tính nhất quán của xác thực giá, không phải bằng chứng ROI+ hoặc tăng tần suất thực thi. Mô phỏng range đang chạy độc lập không sử dụng nhánh LLM adapter này.
