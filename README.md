# 🪙 GoldVision AI (GitHub Free Edition + Telegram Auto-Bot)

Phiên bản độc lập được thiết kế riêng để chạy **100% Miễn Phí trên GitHub Pages & GitHub Actions**, giữ nguyên toàn bộ 7 trụ cột phân tích **SMC • ICT • Price Action • Supply/Demand • Volume Profile • Multi-Timeframe** và tích hợp **Bot Telegram tự động bắn Ảnh Chart + Kèo Entry/SL/TP**.

---

## 🚀 Cách 1: Chạy Web Phân Tích & Bắn Telegram trên GitHub Pages (30 giây)

1. Tạo một Repository mới trên GitHub (ví dụ: `goldvision-ai`).
2. Tải toàn bộ các file trong thư mục `goldvision_github` này lên Repository đó.
3. Trên GitHub, vào mục **Settings** ➔ **Pages** (menu bên trái):
   * Phần **Branch**: Chọn nhánh `main` (hoặc `master`), thư mục `/ (root)` ➔ Bấm **Save**.
4. Sau 1 phút, trang web của bạn sẽ hoạt động tại:
   `https://<tên-github-của-bạn>.github.io/goldvision-ai/`
5. **Tự động bắn Telegram ngay trên Web**:
   * Mở link web, nhìn khung **"🤖 BOT TELEGRAM TỰ ĐỘNG (AUTO-PUSH)"** bên phải.
   * Nhập **Bot Token** (lấy từ `@BotFather`) và **Chat ID** (lấy từ `@userinfobot`), bấm **💾 Lưu Cấu Hình** (chỉ lưu riêng trên trình duyệt máy bạn, không lộ trên GitHub).
   * Bấm **ĐANG BẬT (AUTO)** để web tự động quét giá vàng theo chu kỳ và bắn **Ảnh chụp Biểu đồ PNG + Kèo Entry/SL/TP** về Telegram, hoặc bấm **✈️ Gửi Ảnh Chart + Kèo Ngay** bất cứ lúc nào!

---

## ☁️ Cách 2: Treo Bot Tự Động 24/7 Kể Cả Khi Tắt Máy Tính (GitHub Actions)

Thư mục này đã có sẵn file [`.github/workflows/telegram_auto_bot.yml`](.github/workflows/telegram_auto_bot.yml) và [`telegram_cloud_bot.py`](telegram_cloud_bot.py). Để máy chủ của GitHub tự động phân tích và gửi ảnh biểu đồ về Telegram 24/24 khi bạn tắt máy:

1. Trên Repository GitHub của bạn, vào **Settings** ➔ **Secrets and variables** ➔ **Actions**.
2. Bấm nút **New repository secret** và thêm 2 biến bảo mật sau:
   * Tên Secret 1: `TELEGRAM_BOT_TOKEN` ➔ Giá trị: Token bot của bạn (ví dụ `7123456789:AAH...`)
   * Tên Secret 2: `TELEGRAM_CHAT_ID` ➔ Giá trị: Chat ID nhận tin của bạn (ví dụ `123456789` hoặc `-100...`)
3. Vào tab **Actions** trên GitHub:
   * Chọn workflow **GoldVision AI - 24/7 Telegram Auto-Signal Bot**.
   * Bạn có thể bấm **Run workflow** để test bắn ngay lập tức một bức ảnh Chart HD + Kèo phân tích về Telegram, hoặc để hệ thống tự động chạy ngầm mỗi 15 phút!
