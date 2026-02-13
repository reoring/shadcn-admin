import "dotenv/config"
import express from "express"
import cors from "cors"
import { ExpressAuth } from "@auth/express"
import { authConfig } from "./auth.config.js"

const app = express()
const port = process.env.PORT || 5174
const appUrl = process.env.APP_URL || "http://localhost:5173"
const authUrl = process.env.AUTH_URL || `http://localhost:${port}`
const shouldUseCors =
  (() => {
    try {
      return new URL(authUrl).origin !== new URL(appUrl).origin
    } catch {
      return true
    }
  })()

app.set(
  "trust proxy",
  process.env.AUTH_TRUST_HOST === "true" || process.env.NODE_ENV === "production"
)

if (shouldUseCors) {
  app.use(
    cors({
      origin: appUrl,
      credentials: true,
    })
  )
}

app.use("/api/auth/*", ExpressAuth(authConfig))

app.get("/health", (_req, res) => {
  res.json({ status: "ok" })
})

app.listen(port, () => {
  console.log(`Auth service running on http://localhost:${port}`)
})
