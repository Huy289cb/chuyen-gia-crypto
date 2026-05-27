# Local PostgreSQL (Docker)

Chạy Postgres trên máy/VPS (bind `127.0.0.1` mặc định). Đặt `DATABASE_URL` trong `backend/.env` trỏ về `127.0.0.1` — xem `docs/local-postgres.md`.

## Yêu cầu

- [Docker Engine](https://docs.docker.com/engine/install/) + Docker Compose v2 (`docker compose`)

## Khởi động

```bash
cd docker/local
cp env.example .env
# (tùy chọn) sửa mật khẩu trong .env — nhớ đổi luôn DATABASE_URL ở backend/.env

docker compose up -d
docker compose ps
```

Đợi `healthy` (vài giây), rồi cấu hình backend:

```bash
cd ../../backend
# Trong .env (hoặc export) — khớp user/password/db/port với .env của docker/local
DATABASE_URL="postgresql://crypto:crypto_local_dev@127.0.0.1:5432/chuyen_gia?schema=public"
DIRECT_URL="${DATABASE_URL}"

npx prisma generate
npx prisma db push
# hoặc: npx prisma migrate deploy   # nếu đã có thư mục migrations
```

Chạy API/worker như bình thường (`npm run dev`, PM2, v.v.).

## Dừng / xóa dữ liệu

```bash
cd docker/local
docker compose down          # giữ volume (dữ liệu còn)
docker compose down -v       # xóa volume — mất toàn bộ DB local
```

## Port 5432 bận

Trong `docker/local/.env` đặt `POSTGRES_HOST_PORT=5433` và đổi port trong `DATABASE_URL` tương ứng.

## Tài liệu đầy đủ

Xem [docs/local-postgres.md](../../docs/local-postgres.md).
