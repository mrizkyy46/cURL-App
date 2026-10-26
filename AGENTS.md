# AGENTS.md - Visual cURL Parser & Editor App (Node.js)

## 1. Project Overview & Objective
Proyek ini bertujuan untuk membangun aplikasi web **Visual cURL Parser & Editor** berbasis Node.js.
Aplikasi ini memungkinkan pengguna menempelkan (*paste*) perintah `cURL` hasil *copy-paste* dari **Network Tab Browser DevTools** (Chrome/Firefox/Edge), lalu secara otomatis meng-parse perintah tersebut menjadi form interaktif bergaya **Postman**.

Pengguna dapat mengedit setiap properti request (Method, URL, Query Params, Headers, Body/`data-raw`) secara *real-time*, melihat perubahan perintah cURL baru, serta menggenerasi kode eksekusi Node.js (`fetch` / `axios`).

---

## 2. Tech Stack Requirements
- **Runtime & Backend:** Node.js (v18+) menggunakan Express.js atau Fastify (berfungsi melayani frontend dan menyediakan *Proxy Endpoint* untuk eksekusi tes request guna menghindari CORS).
- **Frontend:** HTML5, CSS3 / Tailwind CSS, JavaScript (Vanilla ES6+ / React / Vue).
- **cURL Engine:** Custom Parsing Logic / `curlconverter` / regex parser.

---

## 3. Core Features & Specifications

### 3.1 Raw cURL Input Section
- **UI Element:** Multi-line `<textarea>` berukuran besar untuk menerima perintah cURL mentah (format Bash, POSIX, atau Windows CMD).
- **Trigger Actions:**
  - Otomatis trigger parser saat event `onpaste` atau perubahan isi textarea.
  - Tombol *"Parse cURL"* dan tombol *"Clear Input"*.
- **Pre-processing:** Membersihkan karakter pemisah baris seperti `\` (macOS/Linux Bash) atau `^` (Windows CMD) serta spasi berlebih.

### 3.2 Postman-Style Form Editor UI
Setelah cURL di-parse, data dipetakan ke komponen form interaktif:

1. **HTTP Method & Target URL:**
   - Dropdown HTTP Method (`GET`, `POST`, `PUT`, `DELETE`, `PATCH`, `HEAD`, `OPTIONS`).
   - Input Text untuk Target URL (otomatis memisahkan Base URL dan Query String).

2. **Query Parameters Editor:**
   - Tabel / List Key-Value Pair dari URL Query Parameters (`?param1=val1&param2=val2`).
   - Fitur per baris: Checkbox Enable/Disable, Input Key, Input Value, Tombol Hapus.
   - Tombol *"Add New Parameter"*.

3. **Headers Editor:**
   - Tabel / List Key-Value Pair untuk semua HTTP Request Headers (`-H` atau `--header`).
   - Fitur per baris: Checkbox Enable/Disable, Input Key, Input Value, Tombol Hapus.
   - Tombol *"Add New Header"*.

4. **Body / `data-raw` Editor:**
   - Radio/Tab selector mode: `none`, `raw (JSON/Text)`, `x-www-form-urlencoded`.
   - Textarea / Code Mirror / Ace Editor untuk mengedit isi `--data-raw`, `--data`, atau `--data-binary`.
   - Tombol *"Format JSON"* (Pretty Print).

---

### 3.3 Output & Snippet Generator Panel
- **Live Reconstructed cURL Preview:** Menampilkan perintah cURL baru yang diperbarui secara *real-time* saat ada perubahan nilai pada form editor.
- **Node.js Code Snippet Generator:**
  - Tab 1: **Node.js Native `fetch()`** (Node 18+).
  - Tab 2: **Node.js `axios`**.
  - Tombol *"Copy Code to Clipboard"*.
- **Request Executor (Test Runner):**
  - Tombol *"Send Request"* yang mengoperasikan request melalui backend proxy Node.js.
  - Panel Response: HTTP Status Code, Execution Time (ms), Response Headers, dan Response Body (Formatted JSON / Raw Text).

---

## 4. Architecture & Data Flow
