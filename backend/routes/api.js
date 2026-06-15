import express from "express";
const router = express.Router();

import inventoryRouter from "./InventoryRoutes.js";
import authenticationRouter from "./AuthenticationRoutes.js";
import authorizationRouter from "./AuthorizationRoutes.js";
import manageUserRouter from "./ManageUserRoutes.js";
import systemRouter from "./SystemRoutes.js";
import cameraRouter from "./CameraRoutes.js";
import incidents from "./IncidentRoutes.js";
import fcmRouter from "./FcmRoutes.js";
import dashboardRouter from "./dashboardRoutes.js";
import reportRouter from "./reportRoutes.js";
import supabase from "../config/supabase/supabase.js";
router.use("/auth", authenticationRouter);
router.use("/authorization", authorizationRouter);
router.use("/manage-user", manageUserRouter);
router.use("/incidents", incidents);
router.use("/inventory", inventoryRouter);
router.use("/camera", cameraRouter);
router.use("/system", systemRouter);
router.use("/fcm", fcmRouter);
router.use("/dashboard", dashboardRouter);
router.use("/reports", reportRouter);
router.get("/test-supabase-storage", async (req, res) => {
  try {
    if (!supabase) {
      return res.json({
        storageDriver: process.env.STORAGE_DRIVER || "local",
        message: "Supabase is not configured; using local file storage.",
      });
    }

    const { data, error } = await supabase.storage.listBuckets();
    if (error) throw error;
    res.json({
      availableBuckets: data.map((b) => b.name),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
