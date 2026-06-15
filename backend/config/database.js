import { Sequelize } from "sequelize";
import dotenv from "dotenv";

dotenv.config();

const isProduction = process.env.NODE_ENV === "production";
const useSsl =
  process.env.DB_SSL === "true" ||
  process.env.DATABASE_URL?.includes("sslmode=require");

const commonOptions = {
  dialect: "postgres",
  logging: false,
  pool: {
    max: 5,
    min: 0,
    acquire: 30000,
    idle: 10000,
  },
  dialectOptions: useSsl
    ? {
        ssl: {
          require: true,
          rejectUnauthorized: false,
        },
      }
    : {},
};

const sequelize = process.env.DATABASE_URL
  ? new Sequelize(process.env.DATABASE_URL, commonOptions)
  : new Sequelize(
      process.env.DB_NAME,
      process.env.DB_USER,
      process.env.DB_PASSWORD,
      {
        ...commonOptions,
        host: process.env.DB_HOST,
        port: process.env.DB_PORT || 5432,
      }
    );

(async () => {
  try {
    await sequelize.authenticate();
    console.log(
      `Postgres connection established successfully${
        isProduction ? "." : " (development)."
      }`
    );
  } catch (error) {
    console.error("Unable to connect to the database:", error);
  }
})();

export default sequelize;
