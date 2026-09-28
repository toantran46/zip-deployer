# Zip Deployer

Mở `start.cmd` bằng double-click. App chạy ẩn tại `127.0.0.1` trên cổng tự chọn và mở trình duyệt. Cần Node.js 18+, Git và Windows PowerShell trên PATH; không cần npm install hoặc XAMPP. Bấm **Dừng app** khi xong; đóng tab trình duyệt không tự dừng server. Mở launcher lần nữa sẽ dùng lại phiên đang chạy.

## Sử dụng
1. Chọn staging / production và đường dẫn repository.
2. Nhập tag/commit thực tế đang chạy trên hosting, sau đó branch/tag/commit muốn triển khai. Ref phải có sẵn ở local; app không tự fetch. Với production, nhập thêm tag mới. Nếu muốn đóng gói tag có sẵn, nhập chính tag đó ở ô nguồn.
3. Bấm **Xem trước thay đổi**. Kiểm tra commit, file thêm/sửa, file xóa và file bị chặn.
4. Bấm **Tạo ZIP**. Nội dung lấy từ Git blob của commit đã xem trước, kể cả khi branch di chuyển sau đó; file chưa commit không đi vào ZIP.
5. Bấm **Mở thư mục kết quả**. Upload duy nhất ZIP deploy vào đúng thư mục gốc hosting theo quy trình của bạn. Đường dẫn ZIP bắt đầu tại gốc repository. Backup hosting trước khi thay thế.
6. Tùy chọn production: mở **Tạo & push tag production**, xác nhận rồi bấm nút. Tool không ghi đè tag, chỉ push tag này lên `origin`; không push branch. Git dùng thông tin đăng nhập đã có; nếu thiếu quyền/auth, thiết lập Git ngoài app rồi thử lại.

## Kết quả
Mỗi lần tạo nằm trong thư mục riêng `output/prod-*` hoặc `output/staging-*`:
- `deploy-*.zip`: file cần upload. Không có thư mục bao ngoài, mọi entry dùng `/`.
- `deploy-files.txt`: file có trong ZIP.
- `deleted-files.txt`: đường dẫn phải kiểm tra/xóa riêng trên hosting, bao gồm đường dẫn cũ khi đổi tên.
- `manifest.json`: commit nguồn/đích, SHA-256 và dung lượng từng file.
- `verification.json`: hash đọc lại từ ZIP.
- `files/`: nội dung trung gian lấy từ Git, có thể xóa cả thư mục kết quả sau khi dùng xong.

App chặn `wp-config.php`, `.env*`, uploads, cccd, error_log, SQL/ZIP, private key, symlink/submodule và đường dẫn không an toàn. Quy tắc theo đường dẫn, **không phải máy quét secret trong nội dung**. Các thư mục gốc docs/tools/tests/.agents/.claude/.codex/.github/node_modules/.deploy-temp và hướng dẫn agent được liệt kê riêng là không đóng gói. Nếu cần deploy những file này, phải chỉnh chính sách có chủ đích trong `core.js`.

Giải nén không tự xóa file, chạy migration, cập nhật WordPress DB hoặc xóa cache. Với thay đổi chỉ xóa file, app hiện danh sách và không tạo ZIP rỗng. Đây là công cụ đóng gói; thành công của ZIP không đồng nghĩa deploy đã hoàn tất.

## Kiểm thử
Từ thư mục app: `node --test test.js`. Dùng repository tạm và bare remote local; không thay đổi tag/remote của dự án. Khởi chạy thủ công: `node server.js`; URL được in ra terminal. Có thể truyền `--repo C:\path\to\repo` và `--open`. Mặc định ô repository để trống để bạn chọn dự án cần đóng gói.

App chỉ nghe loopback, kiểm tra Host/Origin và token phiên trên API. Không mở port ra mạng hoặc đặt thư mục tool lên hosting. Không có dịch vụ tự khởi động cùng Windows.
