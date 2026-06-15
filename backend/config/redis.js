import { createClient } from "redis";
import dotenv from "dotenv";

dotenv.config();

class RedisManager {
  constructor() {
    this.client = null;
    this.isConnecting = false;
    this.connectionAttempts = 0;
    this.maxRetries = 3;
    this.retryDelay = 2000; // 2 seconds
  }

  async connect() {
    // Prevent multiple simultaneous connection attempts
    if (this.isConnecting) {
      await this.waitForConnection();
      return this.client;
    }

    // Return existing client if already connected
    if (this.client && this.client.isReady) {
      return this.client;
    }

    this.isConnecting = true;

    try {
      const clientConfig = process.env.REDIS_URL
        ? {
            url: process.env.REDIS_URL,
            socket: {
              connectTimeout: 10000,
            },
          }
        : {
            username: process.env.REDIS_USERNAME,
            password: process.env.REDIS_PASSWORD,
            socket: {
              host: process.env.REDIS_HOST || "localhost",
              port: parseInt(process.env.REDIS_PORT) || 6379,
              connectTimeout: 10000,
            },
          };

      const client = createClient({
        ...clientConfig,
        retry_unfulfilled_commands: true,
      });

      // Set up event listeners BEFORE connecting
      client.on("error", (err) => {
        console.error("Redis Client Error:", err.message);
        // Don't spam the console with full stack traces
        if (err.code === "ECONNREFUSED" || err.code === "ETIMEDOUT") {
          console.error(`Redis connection failed: ${err.code}`);
        }
      });

      client.on("connect", () => {
        console.log("✅ Connected to Redis");
        this.connectionAttempts = 0; // Reset on successful connection
      });

      client.on("ready", () => {
        console.log("✅ Redis client ready");
      });

      client.on("end", () => {
        console.log("Redis connection ended");
        this.client = null;
      });

      client.on("reconnecting", () => {
        console.log("🔄 Redis reconnecting...");
      });

      // Connect with timeout and retry logic
      await this.connectWithRetry(client);

      // Test connection
      await this.testConnection(client);

      this.client = client;
      this.isConnecting = false;

      console.log("✅ Redis setup completed successfully");
      return client;
    } catch (error) {
      this.isConnecting = false;
      this.connectionAttempts++;

      if (this.connectionAttempts < this.maxRetries) {
        console.warn(
          `❌ Redis connection failed (attempt ${this.connectionAttempts}/${this.maxRetries}). Retrying in ${this.retryDelay}ms...`
        );
        await this.delay(this.retryDelay);
        return this.connect(); // Retry
      } else {
        console.error(
          `❌ Redis connection failed after ${this.maxRetries} attempts. Operating without Redis cache.`
        );
        return null;
      }
    }
  }

  async connectWithRetry(client) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Redis connection timeout"));
      }, 15000); // 15 second timeout

      client
        .connect()
        .then(() => {
          clearTimeout(timeout);
          resolve();
        })
        .catch((error) => {
          clearTimeout(timeout);
          reject(error);
        });
    });
  }

  async testConnection(client) {
    try {
      const testKey = `connection_test_${Date.now()}`;
      await client.set(testKey, "success");
      const result = await client.get(testKey);
      await client.del(testKey); // Clean up

      if (result !== "success") {
        throw new Error("Connection test failed");
      }
    } catch (error) {
      throw new Error(`Redis test failed: ${error.message}`);
    }
  }

  async waitForConnection() {
    let attempts = 0;
    const maxWaitAttempts = 50; // 5 seconds max wait

    while (this.isConnecting && attempts < maxWaitAttempts) {
      await this.delay(100);
      attempts++;
    }
  }

  delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async getClient() {
    if (!this.client || !this.client.isReady) {
      return await this.connect();
    }
    return this.client;
  }

  async disconnect() {
    if (this.client) {
      try {
        await this.client.quit();
        console.log("✅ Redis client disconnected gracefully");
      } catch (error) {
        console.error("Error disconnecting Redis:", error.message);
      } finally {
        this.client = null;
      }
    }
  }

  isConnected() {
    return this.client && this.client.isReady;
  }
}

// Create singleton instance
const redisManager = new RedisManager();

// Export the function to get Redis client
const getRedisClient = async () => {
  try {
    return await redisManager.getClient();
  } catch (error) {
    console.warn("Failed to get Redis client:", error.message);
    return null;
  }
};

// Graceful shutdown
process.on("SIGTERM", async () => {
  console.log("SIGTERM received, closing Redis connection...");
  await redisManager.disconnect();
});

process.on("SIGINT", async () => {
  console.log("SIGINT received, closing Redis connection...");
  await redisManager.disconnect();
});

export default getRedisClient;
export { redisManager };
