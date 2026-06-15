import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

const storageDriver = process.env.STORAGE_DRIVER || "local";
const supabaseUrl = process.env.SB_PROJECT_URL;
const supabaseKey = process.env.SB_SERVICE_KEY;

let supabase = null;

if (supabaseUrl && supabaseKey) {
  supabase = createClient(supabaseUrl, supabaseKey);
  console.log("Supabase client initialized successfully");
} else if (storageDriver === "supabase") {
  throw new Error("Supabase credentials missing in .env file");
} else {
  console.log("Supabase credentials missing; using local file storage");
}

export default supabase;
