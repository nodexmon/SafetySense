import dotenv from "dotenv";
import supabase from "../config/supabase/supabase.js";

dotenv.config();

const bucket = process.env.SUPABASE_STORAGE_BUCKET || "uploads";

async function ensureBucket() {
  if (!supabase) {
    throw new Error(
      "Supabase is not configured. Set STORAGE_DRIVER=supabase, SB_PROJECT_URL, and SB_SERVICE_KEY first."
    );
  }

  const { data: buckets, error: listError } = await supabase.storage.listBuckets();

  if (listError) {
    throw new Error(`Unable to list Supabase buckets: ${listError.message}`);
  }

  const exists = buckets.some((item) => item.name === bucket);

  if (!exists) {
    const { error: createError } = await supabase.storage.createBucket(bucket, {
      public: true,
      fileSizeLimit: 10 * 1024 * 1024,
      allowedMimeTypes: ["image/jpeg", "image/png", "image/webp", "image/gif"],
    });

    if (createError) {
      throw new Error(`Unable to create bucket '${bucket}': ${createError.message}`);
    }

    console.log(`Created Supabase bucket '${bucket}'.`);
  } else {
    console.log(`Supabase bucket '${bucket}' already exists.`);
  }

  const keepFile = "incidents/.keep";
  const { error: uploadError } = await supabase.storage
    .from(bucket)
    .upload(keepFile, new Blob([""]), {
      contentType: "text/plain",
      upsert: true,
    });

  if (uploadError) {
    throw new Error(`Unable to verify incidents folder: ${uploadError.message}`);
  }

  console.log(`Verified '${bucket}/incidents' upload path.`);
}

ensureBucket()
  .then(() => {
    console.log("Supabase storage setup complete.");
    process.exit(0);
  })
  .catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
