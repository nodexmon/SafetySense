import express from "express";
import cors from "cors";
import helmet from "helmet"; // Add this import
import errorHandlerMiddleware from "./middlewares/errorHandlerMiddleware.js";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";
import apiRouter from "./routes/api.js";
import path from "path";
import { fileURLToPath } from "url";

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const localUploadDir = path.resolve(
  __dirname,
  process.env.LOCAL_UPLOAD_DIR || "uploads"
);

const app = express();
app.set("trust proxy", true);
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// Configure Helmet to work with CORS
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    crossOriginEmbedderPolicy: false,
  })
);

// Debug: Log environment variables
console.log("Environment variables:");
console.log(
  "FRONTEND_DOMAIN_NOT_SECURE:",
  process.env.FRONTEND_DOMAIN_NOT_SECURE
);
console.log("FRONTEND_DOMAIN_SECURE:", process.env.FRONTEND_DOMAIN_SECURE);
console.log("FRONTEND_LOCAL:", process.env.FRONTEND_LOCAL);

const allowedOrigins = [
  process.env.FRONTEND_DOMAIN_NOT_SECURE || "http://safetysense.team",
  process.env.FRONTEND_DOMAIN_SECURE || "https://www.safetysense.team",
  process.env.FRONTEND_LOCAL || "http://localhost:5173",
];

console.log("Allowed origins:", allowedOrigins);

// CORS Configuration
app.use(
  cors({
    origin: (origin, callback) => {
      const allowedOrigins = [
        "http://safetysense.team",
        "https://safetysense.team",
        "http://www.safetysense.team",
        "https://www.safetysense.team",
        "http://localhost:5173",
      ];
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Requested-With",
      "Accept",
      "Origin",
    ],
    exposedHeaders: ["Set-Cookie"],
  })
);

// Handle preflight explicitly
app.options("*", cors());

// Other middlewares
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use("/uploads", express.static(localUploadDir));
app.use("/api", apiRouter);

// Error handler
app.use(errorHandlerMiddleware);

// Start backend
const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`File uploads storage driver: ${process.env.STORAGE_DRIVER || "local"}`);
  console.log("CORS enabled for origins:", allowedOrigins);
});
