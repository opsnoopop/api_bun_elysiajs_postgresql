// app.ts
import { Elysia, t } from 'elysia'
import postgres from 'postgres'

// สร้าง Postgres client (postgres.js มี pool ในตัว)
const sql = postgres({
  host: process.env.DB_HOST,
  username: process.env.DB_USER,   // ✅ postgres.js ใช้ "username"
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: Number(process.env.DB_PORT || 5432),

  // tuning ใกล้เคียงกับของเดิม
  max: 10,               // จำนวน connection สูงสุด
  idle_timeout: 30,      // วินาที (เทียบกับ idleTimeoutMillis: 30_000)
  connect_timeout: 5,    // วินาที (เทียบกับ connectionTimeoutMillis: 5_000)
})

// ประกาศ type ให้ Elysia เห็น field db ที่เป็นอินสแตนซ์ของ postgres()
type SQL = ReturnType<typeof postgres>

const app = new Elysia()
  // inject db เข้า context ของทุก handler เป็น `db`
  .decorate('db', sql as SQL)

  // global error handler
  .onError(({ code, error, set }) => {
    if (code === 'VALIDATION') {
      set.status = 400
      return { error: 'Bad Request', detail: error.message }
    }
    set.status = 500
    return { error: 'Internal Server Error', detail: error.message }
  })

  // health route
  .get('/', () => ({ message: 'Hello World from Bun (ElysiaJS + PostgreSQL)' }))

  // POST /users -> create user
  .post(
    '/users',
    async ({ body, db, set }) => {
      const { username, email } = body as { username: string; email: string }
      try {
        // postgres.js ใช้ template literal query + parameter binding อัตโนมัติ
        const [row] = await db`
          INSERT INTO users (username, email)
          VALUES (${username}, ${email})
          RETURNING user_id
        `
        // หมายเหตุ: ถ้า user_id เป็น int4 จะกลับมาเป็น number อยู่แล้ว
        // แต่ถ้าเป็น int8 อาจได้ BigInt -> cast เป็น Number ตามต้องการ
        const userId = Number(row.user_id)
        set.status = 201
        return { message: 'User created successfully', user_id: userId }
      } catch (err: any) {
        set.status = 500
        return { error: 'Database error', detail: String(err?.message ?? err) }
      }
    },
    {
      body: t.Object({
        username: t.String({ minLength: 1 }),
        email: t.String({ format: 'email' })
      })
    }
  )

  // GET /users/:id -> fetch user by id
  .get(
    '/users/:id',
    async ({ params, db, set }) => {
      try {
        const id = Number(params.id) // แปลงเป็น number ก่อนเสมอ
        const [row] = await db`
          SELECT user_id, username, email
          FROM users
          WHERE user_id = ${id}
        `
        if (!row) {
          set.status = 404
          return { error: 'User not found' }
        }
        return {
          user_id: Number(row.user_id),
          username: row.username,
          email: row.email
        }
      } catch (err: any) {
        set.status = 500
        return { error: 'Database error', detail: String(err?.message ?? err) }
      }
    },
    {
      // Elysia v1+: t.Numeric จะช่วย parse string->number อัตโนมัติ
      params: t.Object({ id: t.Numeric() })
    }
  )

  .listen(3000)

// graceful shutdown: ปิด connection pool ของ postgres.js
const shutdown = async () => {
  try {
    // ปิดด้วย timeout (มิลลิวินาที) เพื่อรอ query ที่ค้างให้เสร็จ
    await sql.end({ timeout: 5_000 })
  } finally {
    process.exit(0)
  }
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

console.log(`🦊 Elysia is running at http://localhost:${app.server?.port}`)
