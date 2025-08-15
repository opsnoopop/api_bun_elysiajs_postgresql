// app.ts
import { Elysia, t } from 'elysia'
import pkg from 'pg'
const { Pool } = pkg

// สร้าง Postgres pool
const pool = new Pool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: Number(process.env.DB_PORT || 5432),
  max: 10,                    // จำนวน connection สูงสุด
  idleTimeoutMillis: 30_000,  // ปิด connection ถ้า idle
  connectionTimeoutMillis: 5_000
})

const app = new Elysia()
  // inject db เข้า context ของทุก handler เป็น `db`
  .decorate('db', pool)

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
  .get('/', () => ({ message: 'Hello World from Bun' }))

  // POST /users -> create user
  .post(
    '/users',
    async ({ body, db, set }) => {
      const { username, email } = body as { username: string; email: string }
      try {
        // ใช้ $1, $2 สำหรับ parameterized query และ RETURNING เพื่อรับ id ที่สร้าง
        const result = await db.query(
          'INSERT INTO users (username, email) VALUES ($1, $2) RETURNING user_id',
          [username, email]
        )
        const userId = result.rows[0]?.user_id
        set.status = 201
        return { message: 'User created successfully', user_id: Number(userId) }
      } catch (err: any) {
        set.status = 500
        return { error: 'Database error', detail: err.message }
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
        const id = Number(params.id) // ปลอดภัยกว่าถ้า cast เป็น number ก่อน
        const result = await db.query(
          'SELECT user_id, username, email FROM users WHERE user_id = $1',
          [id]
        )
        const row = result.rows[0]
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
        return { error: 'Database error', detail: err.message }
      }
    },
    {
      // Elysia v1+ t.Numeric จะช่วย parse string->number
      params: t.Object({ id: t.Numeric() })
    }
  )

  .listen(3000)

// graceful shutdown: ปิด pool เมื่อ process ถูก kill
const shutdown = async () => {
  try {
    await pool.end()
  } finally {
    process.exit(0)
  }
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

console.log(`🦊 Elysia is running at http://localhost:${app.server?.port}`)
