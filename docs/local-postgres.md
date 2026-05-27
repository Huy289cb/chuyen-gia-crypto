# PostgreSQL (Docker trên VPS / máy dev)

Đây là **cách chạy Postgres mặc định** cho backend: DB nằm **on-box** (`127.0.0.1`), phù hợp worker chạy liên tục và không phụ thuộc dịch vụ cloud có giới hạn compute. Stack: `docker/local/`.

## 1. Chạy container

```bash
cd docker/local
cp env.example .env
docker compose up -d
```

Nếu user chưa nằm trong group `docker`, dùng `sudo docker compose ...` tương đương.

Kiểm tra:

```bash
docker compose ps
docker compose exec postgres psql -U crypto -d chuyen_gia -c 'SELECT 1'
```

## 2. Backend `DATABASE_URL`

Trong `backend/.env` (không commit file này):

```env
DATABASE_URL="postgresql://crypto:crypto_local_dev@127.0.0.1:5432/chuyen_gia?schema=public"
DIRECT_URL="postgresql://crypto:crypto_local_dev@127.0.0.1:5432/chuyen_gia?schema=public"
```

- Đổi `crypto` / `crypto_local_dev` / `chuyen_gia` nếu bạn đã sửa `docker/local/.env`.
- Local Postgres **không** cần `sslmode=require`.

## 3. Schema

```bash
cd backend
npm run prisma:generate
npx prisma db push
```

Hoặc nếu repo đã có migrations đầy đủ:

```bash
npx prisma migrate deploy
```

## 4. Production VPS

1. Cài Docker trên VPS, clone repo (hoặc sync code).
2. `cd docker/local && cp env.example .env` — **đặt mật khẩu mạnh** trong `.env`.
3. `docker compose up -d`.
4. Trên VPS `backend/.env`, đặt `DATABASE_URL` trỏ `127.0.0.1` và cùng user/password/db.
5. `pm2 restart crypto-api crypto-worker` (hoặc `./scripts/deploy.sh`).

Bind mặc định **`127.0.0.1:5432`** (chỉ máy local/VPS, không mở ra internet). Trong `docker/local/.env` có thể đặt `POSTGRES_BIND=0.0.0.0` nếu cần truy cập từ máy khác trong LAN (kèm firewall).

## 5. Sao lưu

Volume tên `chuyen_gia_pgdata`. Backup:

```bash
docker compose exec -T postgres pg_dump -U crypto chuyen_gia > backup.sql
```

## Postgres managed (tùy chọn)

Có thể dùng bất kỳ Postgres tương thích nào (RDS, Supabase, self-host khác): chỉ cần cập nhật `DATABASE_URL` / `DIRECT_URL` theo hướng dẫn của nhà cung cấp (thường có TLS). Worker luôn bật nên ưu tiên gói **không sleep** hoặc **connection pool** phù hợp số process PM2.
