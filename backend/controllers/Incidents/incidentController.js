import { Op } from "sequelize"; // Import models from the index file to ensure associations are loaded
import models from "../../models/index.js";
const {
  Incident,
  HumanIncident,
  YOLOIncident,
  Camera,
  User,
  IncidentAcceptance,
  IncidentDismissal,
} = models;

import { BadRequestError, NotFoundError } from "../../utils/Error.js";
import { StatusCodes } from "http-status-codes";
import sequelize from "../../config/database.js";
import { sendTopicNotification } from "../../services/firebase/fcmService.js";

import xlsx from "xlsx";
import path from "path";
import { fileURLToPath } from "url";
import { getFileUrl, getFilePath } from "../../config/multer.js";

// Get current directory for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Create a new incident (handles both citizen reports and camera detections)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
const createIncident = async (req, res, next) => {
  if (req.body.cameraId) {
    return createCameraDetection(req, res, next);
  } else {
    return createCitizenReport(req, res, next);
  }
};

/**
 * Create citizen report with file upload in one step
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
const createCitizenReport = async (req, res, next) => {
  let transaction;

  try {
    transaction = await sequelize.transaction();

    const {
      reportedBy,
      contact,
      type,
      description,
      longitude,
      latitude,
      snapshotUrl,
      ipAddress,
    } = req.body;

    const missing = [];
    if (!type) missing.push("type");
    if (!longitude) missing.push("longitude");
    if (!latitude) missing.push("latitude");
    if (!snapshotUrl) missing.push("image");
    if (missing.length > 0)
      throw new BadRequestError(`Missing fields: ${missing.join(", ")}`);

    // ✅ Create Incident (within transaction)
    const incident = await Incident.create(
      {
        type,
        description,
        snapshotUrl,
        reportType: "human",
        longitude,
        latitude,
        status: "pending",
      },
      { transaction }
    );

    // ✅ Create HumanIncident (within transaction)
    await HumanIncident.create(
      {
        incidentId: incident.id, // ✅ use incidentId, not id
        reportedBy: reportedBy || "Anonymous Citizen",
        contact: contact || null,
        ipAddress,
      },
      { transaction }
    );

    // ✅ Commit transaction before sending notifications
    await transaction.commit();

    // ✅ Send notification after commit
    try {
      const shortDescription =
        incident.description?.length > 100
          ? `${incident.description.substring(0, 100)}...`
          : incident.description;

      const notificationTitle = `${type} Incident Alert!`;
      const notificationBody = `${shortDescription} - Reported by: ${
        reportedBy || "Anonymous Citizen"
      }`;

      await sendTopicNotification(
        process.env.RESPONDER_TOPIC || "all_responders",
        notificationTitle,
        notificationBody,
        {
          incidentId: incident.id.toString(),
          type: incident.type,
          latitude: incident.latitude.toString(),
          longitude: incident.longitude.toString(),
          hasImage: !!incident.snapshotUrl,
        }
      );
    } catch (notificationError) {
      console.warn("⚠️ FCM notification failed:", notificationError.message);
    }

    // ✅ Fetch full incident with associations (no transaction)
    const created = await Incident.findByPk(incident.id, {
      include: [{ model: HumanIncident, as: "humanDetails" }],
    });

    return res.status(StatusCodes.CREATED).json({
      success: true,
      message: "Citizen report created successfully",
      data: created,
    });
  } catch (error) {
    // Only rollback if not already committed
    if (transaction && !transaction.finished) {
      await transaction.rollback();
    }
    next(error);
  }
};

/**
 * Create a new incident specifically from camera detection
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
const createCameraDetection = async (req, res, next) => {
  let transaction;
  try {
    transaction = await sequelize.transaction();

    const {
      cameraId,
      aiType,
      confidence,
      description,
      type,
      longitude,
      latitude,
      snapshotUrl, // optional pre-signed or Supabase URL
    } = req.body;

    if (!cameraId || !type || !longitude || !latitude)
      throw new BadRequestError("Missing required fields");

    const camera = await Camera.findByPk(cameraId);
    if (!camera) throw new NotFoundError("Camera not found");

    // ✅ Create Incident (within transaction)
    const incident = await Incident.create(
      {
        type,
        reportType: "yolo", // ✅ Correct report type
        description,
        snapshotUrl,
        longitude,
        latitude,
        status: "pending",
      },
      { transaction }
    );

    // ✅ Create YOLOIncident (within transaction)
    await YOLOIncident.create(
      {
        incidentId: incident.id, // ✅ Use incidentId for consistency
        cameraId,
        aiType: aiType || "ObjectDetected",
        confidence: confidence || 1.0,
      },
      { transaction }
    );

    // ✅ Commit transaction before sending notifications
    await transaction.commit();

    // ✅ Send notification after commit
    try {
      const shortDescription =
        incident.description?.length > 100
          ? `${incident.description.substring(0, 100)}...`
          : incident.description;

      const notificationTitle = `${type} Incident Alert!`;
      const notificationBody = `${shortDescription} - AI Reported`;

      await sendTopicNotification(
        process.env.RESPONDER_TOPIC || "all_responders",
        notificationTitle,
        notificationBody,
        {
          incidentId: incident.id.toString(),
          type: incident.type,
          latitude: incident.latitude.toString(),
          longitude: incident.longitude.toString(),
          hasImage: !!incident.snapshotUrl,
        }
      );
    } catch (notificationError) {
      console.warn("⚠️ FCM notification failed:", notificationError.message);
    }

    // ✅ Fetch full incident with associations (no transaction) - use correct association name
    const created = await Incident.findByPk(incident.id, {
      include: [{ model: YOLOIncident, as: "yoloDetails" }], // ✅ Changed from "YOLOIncident" to "yoloDetails"
    });

    return res.status(StatusCodes.CREATED).json({
      success: true,
      message: "AI detection recorded successfully",
      data: created,
    });
  } catch (error) {
    // Only rollback if not already committed
    if (transaction && !transaction.finished) {
      await transaction.rollback();
    }
    next(error);
  }
};
const getIncidents = async (req, res, next) => {
  try {
    const {
      search,
      status,
      type,
      cameraId,
      startDate,
      endDate,
      page = 1,
      limit = 10,
      showDeleted = "false",
      sortBy = "createdAt",
      sortOrder = "desc",
      source,
    } = req.query;

    const whereCondition = {};

    // 🔍 Text search
    if (search) {
      whereCondition[Op.or] = [{ description: { [Op.like]: `%${search}%` } }];
    }

    // Filters
    if (status) whereCondition.status = status;
    if (type) whereCondition.type = type;

    // 🔄 Source filter
    if (source === "citizen") whereCondition.reportType = "human";
    else if (source === "camera") whereCondition.reportType = "yolo";

    // 📅 Date range filter
    if (startDate || endDate) {
      whereCondition.createdAt = {};
      if (startDate) whereCondition.createdAt[Op.gte] = new Date(startDate);
      if (endDate) whereCondition.createdAt[Op.lte] = new Date(endDate);
    }

    // 🧩 YOLO include with optional cameraId filter and full camera details
    const yoloInclude = {
      model: YOLOIncident,
      as: "yoloDetails",
      attributes: [
        "id",
        "cameraId",
        "aiType",
        "confidence",
        "detectionFrameUrl",
        "modelVersion",
        "detectedObjects",
        "processingTime",
      ],
      required: false,
      where: {},
      include: [
        {
          model: Camera,
          as: "camera",
          attributes: [
            "id",
            "name",
            "ipAddress",
            "rtspUrl",
            "location",
            "longitude",
            "latitude",
            "model",
            "description",
            "status",
            "lastCheckedAt",
            "lastOnlineAt",
          ],
          required: false,
        },
      ],
    };

    // Apply cameraId filter to YOLOIncident if provided
    if (cameraId) yoloInclude.where.cameraId = cameraId;

    // 📄 Pagination & Sorting
    const pageNumber = parseInt(page, 10);
    const limitNumber = parseInt(limit, 10);
    const offset = (pageNumber - 1) * limitNumber;
    const paranoidOption = showDeleted !== "true";
    const order = [[sortBy, sortOrder.toLowerCase()]];

    // 🧩 Fetch incidents with associations
    const { count, rows } = await Incident.findAndCountAll({
      where: whereCondition,
      include: [
        yoloInclude,
        {
          model: HumanIncident,
          as: "humanDetails",
          attributes: ["id", "reportedBy", "contact", "ipAddress"],
          required: false,
        },
        {
          model: User,
          as: "accepters",
          attributes: ["id", "firstname", "lastname", "email", "contact"],
          through: { attributes: ["acceptedAt"] },
        },
        {
          model: User,
          as: "dismissers",
          attributes: ["id", "firstname", "lastname", "email", "contact"],
          through: { attributes: ["dismissedAt"] },
        },
      ],
      paranoid: paranoidOption,
      offset,
      limit: limitNumber,
      order,
      distinct: true,
    });

    // 🖼️ Add signed URLs for snapshots
    const dataWithUrls = rows.map((incident) => {
      const urls = {};

      if (incident.snapshotUrl) {
        urls.main = getFileUrl(incident.snapshotUrl);
      }

      if (incident.yoloDetails?.detectionFrameUrl) {
        urls.ai = getFileUrl(incident.yoloDetails.detectionFrameUrl);
      }

      incident.dataValues.snapshotSignedUrls = urls;
      return incident;
    });

    // 🟢 Response
    return res.status(StatusCodes.OK).json({
      success: true,
      message: "Incidents retrieved successfully",
      pagination: {
        total: count,
        totalPages: Math.ceil(count / limitNumber),
        currentPage: pageNumber,
        limit: limitNumber,
      },
      data: dataWithUrls,
    });
  } catch (error) {
    console.error("Error fetching incidents:", error);
    next(error);
  }
};

const getIncident = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!id) throw new BadRequestError("Incident ID is required");

    const incident = await Incident.findByPk(id, {
      include: [
        {
          model: YOLOIncident,
          as: "yoloDetails",
          attributes: [
            "id",
            "cameraId",
            "aiType",
            "confidence",
            "detectionFrameUrl",
            "modelVersion",
            "detectedObjects",
            "processingTime",
          ],
          required: false,
          include: [
            {
              model: Camera,
              as: "camera",
              attributes: [
                "id",
                "name",
                "ipAddress",
                "rtspUrl",
                "location",
                "longitude",
                "latitude",
                "model",
                "description",
                "status",
                "lastCheckedAt",
                "lastOnlineAt",
              ],
              required: false,
            },
          ],
        },
        {
          model: HumanIncident,
          as: "humanDetails",
          attributes: ["id", "reportedBy", "contact", "ipAddress"],
          required: false,
        },
        {
          model: User,
          as: "accepters",
          attributes: ["id", "firstname", "lastname", "email", "contact"],
          through: { attributes: ["acceptedAt"] },
        },
        {
          model: User,
          as: "dismissers",
          attributes: ["id", "firstname", "lastname", "email", "contact"],
          through: { attributes: ["dismissedAt"] },
        },
      ],
    });

    if (!incident) throw new NotFoundError("Incident not found");

    // 🖼️ Snapshot URL
    if (incident.snapshotUrl) {
      incident.dataValues.snapshotSignedUrl = getFileUrl(incident.snapshotUrl);
    }

    // 🤖 YOLO frame URL
    if (incident.yoloDetails?.detectionFrameUrl) {
      incident.dataValues.aiFrameSignedUrl = getFileUrl(
        incident.yoloDetails.detectionFrameUrl
      );
    }

    // 📡 Determine source type based on reportType
    const sourceType = incident.reportType === "yolo" ? "camera" : "citizen";

    return res.status(StatusCodes.OK).json({
      success: true,
      message: "Incident retrieved successfully",
      data: {
        ...incident.toJSON(),
        sourceType,
      },
    });
  } catch (error) {
    console.error("❌ Error in getIncident:", error);
    next(error);
  }
};
const getIncidentsForHeatmap = async (req, res, next) => {
  try {
    const { filter, startDate, endDate, type, source } = req.query;

    const where = {};

    // 📅 Date filtering
    if (filter === "last7days") {
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      where.createdAt = { [Op.gte]: sevenDaysAgo };
    }

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt[Op.gte] = new Date(startDate);
      if (endDate) where.createdAt[Op.lte] = new Date(endDate);
    }

    // 🧩 Type filtering
    if (type) {
      where.type = {
        [Op.eq]: type.charAt(0).toUpperCase() + type.slice(1).toLowerCase(),
      };
    }

    // 🧠 Source filtering (FIXED)
    // We use 'reportType' because 'cameraId' does not exist on the main Incident table
    if (source === "citizen") {
      where.reportType = "human";
    } else if (source === "camera") {
      where.reportType = "yolo";
    }

    // 📦 Query incidents with related data
    const incidents = await Incident.findAll({
      where,
      // ❌ REMOVED "cameraId" from here because it's not in the Incidents table
      attributes: ["latitude", "longitude", "type"],
      include: [
        {
          model: YOLOIncident,
          as: "yoloDetails",
          // ✅ ADDED "cameraId" here because it belongs to the YOLOIncident model
          attributes: ["aiType", "confidence", "cameraId"],
          required: false,
        },
        {
          model: HumanIncident,
          as: "humanDetails",
          attributes: ["reportedBy", "contact"],
          required: false,
        },
      ],
      raw: true,
    });

    // ⚙️ Intensity weights
    const TYPE_INTENSITY = {
      Fire: 5,
      Medical: 4,
      Accident: 3,
      Crime: 4,
      Flood: 3,
      Other: 1,
    };

    const coordMap = {};
    const round = (val, precision = 4) => Number(val).toFixed(precision);

    for (const incident of incidents) {
      const {
        latitude,
        longitude,
        type,
        "yoloDetails.aiType": aiType,
      } = incident;

      if (!latitude || !longitude) continue;

      const lat = round(latitude);
      const lon = round(longitude);
      const key = `${lat},${lon}`;

      // Determine type weight
      const normalizedType = type || aiType || "Other";
      const intensity = TYPE_INTENSITY[normalizedType] || TYPE_INTENSITY.Other;

      coordMap[key] = (coordMap[key] || 0) + intensity;
    }

    // 🗺️ Format for frontend
    const heatmapData = Object.entries(coordMap).map(([key, intensity]) => {
      const [lat, lon] = key.split(",").map(Number);
      return [lat, lon, intensity];
    });

    console.log(`✅ Heatmap generated: ${heatmapData.length} points`);

    return res.status(StatusCodes.OK).json({
      success: true,
      message: "Heatmap data generated successfully",
      data: heatmapData,
    });
  } catch (error) {
    console.error("❌ Heatmap Error:", error);
    next(error);
  }
};

const softDeleteIncident = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!id) throw new BadRequestError("Incident ID is required");

    const incident = await Incident.findByPk(id);
    if (!incident) throw new NotFoundError("Incident not found");

    await incident.destroy(); // Soft delete since paranoid is true

    return res.status(StatusCodes.OK).json({
      success: true,
      message: "Incident has been soft deleted",
    });
  } catch (error) {
    console.error("An error occurred: " + error);
    next(error);
  }
};

/**
 * Restore soft deleted incident
 */
const restoreIncident = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!id) throw new BadRequestError("Incident ID is required");

    const incident = await Incident.findOne({
      where: { id },
      paranoid: false,
    });

    if (!incident) throw new NotFoundError("Incident not found");

    await incident.restore(); // Restore soft deleted incident

    return res.status(StatusCodes.OK).json({
      success: true,
      message: "Incident has been restored",
    });
  } catch (error) {
    console.error("An error occurred: " + error);
    next(error);
  }
};

/**
 * Accept an incident by a user
 */
const acceptIncident = async (req, res, next) => {
  let transaction;

  try {
    transaction = await sequelize.transaction();

    const { incidentId } = req.params;
    const { userId } = req.body;

    if (!incidentId || !userId)
      throw new BadRequestError("Incident ID and User ID are required");

    // Validate incident exists
    const incident = await Incident.findByPk(incidentId);
    if (!incident) throw new NotFoundError("Incident not found");

    // Validate user exists
    const user = await User.findByPk(userId);
    if (!user) throw new NotFoundError("User not found");

    // Check if already accepted
    const existingAcceptance = await IncidentAcceptance.findOne({
      where: { incidentId, userId },
    });

    if (existingAcceptance) {
      throw new BadRequestError("Incident already accepted by this user");
    }

    // Create acceptance record
    await IncidentAcceptance.create(
      {
        incidentId,
        userId,
        acceptedAt: new Date(),
      },
      { transaction }
    );

    // Update incident status to accepted if not already
    if (incident.status === "pending" || incident.status === "verified") {
      await incident.update({ status: "accepted" }, { transaction });
    }

    await transaction.commit();
    transaction = null;

    return res.status(StatusCodes.OK).json({
      success: true,
      message: "Incident accepted successfully",
    });
  } catch (error) {
    if (transaction) await transaction.rollback();
    console.error("An error occurred: " + error);
    next(error);
  }
};

/**
 * Dismiss an incident for a specific user (per-user dismissal)
 */
const dismissIncident = async (req, res, next) => {
  let transaction;

  try {
    transaction = await sequelize.transaction();

    const { incidentId } = req.params;
    const { userId, reason } = req.body;

    if (!incidentId || !userId)
      throw new BadRequestError("Incident ID and User ID are required");

    // Validate incident exists
    const incident = await Incident.findByPk(incidentId);
    if (!incident) throw new NotFoundError("Incident not found");

    // Validate user exists
    const user = await User.findByPk(userId);
    if (!user) throw new NotFoundError("User not found");

    // Check if already dismissed by this user
    const existingDismissal = await IncidentDismissal.findOne({
      where: { incidentId, userId },
    });

    if (existingDismissal) {
      throw new BadRequestError("Incident already dismissed by this user");
    }

    // Create dismissal record
    await IncidentDismissal.create(
      {
        incidentId,
        userId,
        dismissedAt: new Date(),
        reason: reason || null,
      },
      { transaction }
    );

    await transaction.commit();
    transaction = null;

    return res.status(StatusCodes.OK).json({
      success: true,
      message: "Incident dismissed for this user successfully",
    });
  } catch (error) {
    if (transaction) await transaction.rollback();
    console.error("An error occurred: " + error);
    next(error);
  }
};

/**
 * Get dismissed incidents by a user
 */

/**
 * Get users who accepted an incident
 */
const getUsersByIncident = async (req, res, next) => {
  try {
    const { incidentId } = req.params;

    if (!incidentId) throw new BadRequestError("Incident ID is required");

    // Validate incident exists
    const incident = await Incident.findByPk(incidentId);
    if (!incident) throw new NotFoundError("Incident not found");

    const users = await Incident.findByPk(incidentId, {
      include: [
        {
          model: User,
          as: "accepters",
          attributes: [
            "id",
            "firstname",
            "lastname",
            "email",
            "contact",
            "role",
          ],
          through: { attributes: ["acceptedAt"] },
        },
      ],
    });

    if (!users || !users.accepters) {
      return res.status(StatusCodes.OK).json({
        success: true,
        message: "No users have accepted this incident",
        data: [],
        count: 0,
      });
    }

    return res.status(StatusCodes.OK).json({
      success: true,
      message: "Incident accepters retrieved successfully",
      data: users.accepters,
      count: users.accepters.length,
    });
  } catch (error) {
    console.error("An error occurred: " + error);
    next(error);
  }
};

const generateEmptyTemplate = async (req, res, next) => {
  try {
    const headers = [
      "name",
      "description",
      "category",
      "type",
      "quantity_in_stock",
      "unit_price",
      "min_stock_level",
      "reorder_level",
      "unit_of_measure",
      "condition",
      "location",
      "is_deployable",
      "supplier",
      "funding_source",
      "batch_notes",
      "notes",
    ];

    const workbook = xlsx.utils.book_new();
    const worksheet = xlsx.utils.aoa_to_sheet([headers]);

    worksheet["!cols"] = headers.map(() => ({ wch: 20 }));

    xlsx.utils.book_append_sheet(workbook, worksheet, "Inventory Template");

    const buffer = xlsx.write(workbook, {
      type: "buffer",
      bookType: "xlsx",
    });

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="inventory_template_empty.xlsx"'
    );

    res.status(StatusCodes.OK).send(buffer);
  } catch (error) {
    next(error);
  }
};

// ============================================
// UPDATED: updateIncident function
// ============================================
const updateIncident = async (req, res, next) => {
  let transaction;

  try {
    transaction = await sequelize.transaction();

    const { id } = req.params;
    const {
      cameraId,
      reportedBy,
      contact,
      type,
      snapshotUrl,
      description,
      status,
      longitude,
      latitude,
      source,
      aiConfidence,
      aiModelVersion,
      aiImageUrl,
      aiDetectedAt,
    } = req.body;

    if (!id) throw new BadRequestError("Incident ID is required");

    if (
      cameraId === undefined &&
      !reportedBy &&
      !contact &&
      !type &&
      snapshotUrl === undefined &&
      description === undefined &&
      !status &&
      longitude === undefined &&
      latitude === undefined &&
      !source &&
      aiConfidence === undefined &&
      !aiModelVersion &&
      !aiImageUrl &&
      !aiDetectedAt
    ) {
      throw new BadRequestError("At least one field to update is required");
    }

    const incident = await Incident.findByPk(id);
    if (!incident) throw new NotFoundError("Incident not found");

    // ✅ Validate camera
    if (cameraId) {
      const camera = await Camera.findByPk(cameraId);
      if (!camera) throw new NotFoundError("Camera not found");
    }

    // ✅ Validate and normalize type
    if (type) {
      const validTypes = [
        "fire",
        "accident",
        "medical",
        "crime",
        "flood",
        "other",
      ];
      const normalizedType = type.toLowerCase();
      if (!validTypes.includes(normalizedType))
        throw new BadRequestError("Invalid incident type");
      incident.type = normalizedType;
    }

    // ✅ Validate status
    if (status) {
      const validStatuses = [
        "pending",
        "verified",
        "accepted",
        "resolved",
        "dismissed",
      ];
      if (!validStatuses.includes(status))
        throw new BadRequestError("Invalid incident status");
    }

    // ✅ Prepare update data
    const updateData = {};
    if (cameraId === null || cameraId) updateData.cameraId = cameraId;
    if (reportedBy) updateData.reportedBy = reportedBy;
    if (contact) updateData.contact = contact;
    if (type) updateData.type = type.toLowerCase();
    if (snapshotUrl !== undefined) updateData.snapshotUrl = snapshotUrl;
    if (description !== undefined) updateData.description = description;
    if (status) updateData.status = status;
    if (longitude !== undefined) updateData.longitude = longitude;
    if (latitude !== undefined) updateData.latitude = latitude;
    if (source) updateData.source = source;

    await incident.update(updateData, { transaction });

    // ========================================
    // 🤖 AI INCIDENT HANDLING (YOLOIncident)
    // ========================================
    if (source?.toLowerCase() === "ai" || aiConfidence || aiModelVersion) {
      const existingYoloIncident = await YOLOIncident.findOne({
        where: { incidentId: id },
        transaction,
      });

      const yoloData = {
        incidentId: id,
        confidence: aiConfidence ?? existingYoloIncident?.confidence,
        modelVersion: aiModelVersion ?? existingYoloIncident?.modelVersion,
        detectionFrameUrl:
          aiImageUrl ?? existingYoloIncident?.detectionFrameUrl,
        detectedAt:
          aiDetectedAt ?? existingYoloIncident?.detectedAt ?? new Date(),
      };

      if (existingYoloIncident) {
        await existingYoloIncident.update(yoloData, { transaction });
      } else {
        await YOLOIncident.create(yoloData, { transaction });
      }
    }

    await transaction.commit();
    transaction = null;

    // ========================================
    // 🔄 Fetch updated data with CORRECT associations
    // ========================================
    const updatedIncident = await Incident.findByPk(id, {
      include: [
        {
          model: YOLOIncident,
          as: "yoloDetails",
          attributes: [
            "id",
            "cameraId",
            "aiType",
            "confidence",
            "detectionFrameUrl",
            "modelVersion",
            "detectedObjects",
            "processingTime",
          ],
          required: false,
          include: [
            {
              model: Camera,
              as: "camera",
              attributes: [
                "id",
                "name",
                "ipAddress",
                "rtspUrl",
                "location",
                "longitude",
                "latitude",
                "model",
                "description",
                "status",
                "lastCheckedAt",
                "lastOnlineAt",
              ],
              required: false,
            },
          ],
        },
        {
          model: HumanIncident,
          as: "humanDetails",
          attributes: ["id", "reportedBy", "contact", "ipAddress"],
          required: false,
        },
        {
          model: User,
          as: "accepters",
          attributes: ["id", "firstname", "lastname", "email", "contact"],
          through: { attributes: ["acceptedAt"] },
        },
        {
          model: User,
          as: "dismissers",
          attributes: ["id", "firstname", "lastname", "email", "contact"],
          through: { attributes: ["dismissedAt"] },
        },
      ],
    });

    return res.status(StatusCodes.OK).json({
      success: true,
      message: "Incident updated successfully",
      data: updatedIncident,
    });
  } catch (error) {
    if (transaction) await transaction.rollback();
    console.error("An error occurred: " + error);
    next(error);
  }
};

// ============================================
// UPDATED: getDeletedIncidents function
// ============================================
const getDeletedIncidents = async (req, res, next) => {
  try {
    const {
      search,
      status,
      type,
      reportType,
      cameraId,
      page,
      limit,
      sortBy,
      sortOrder,
    } = req.query;

    const whereCondition = {
      deletedAt: { [Op.ne]: null }, // Fetch only soft-deleted incidents
    };

    // Search condition
    if (search) {
      whereCondition[Op.or] = [{ description: { [Op.like]: `%${search}%` } }];
    }

    // Filter conditions
    if (status) whereCondition.status = status;
    if (type) whereCondition.type = type;
    if (reportType) whereCondition.reportType = reportType;

    // Pagination
    const pageNumber = Number.parseInt(page) || 1;
    const limitNumber = Number.parseInt(limit) || 10;
    const offset = (pageNumber - 1) * limitNumber;

    // Sorting
    const validSortColumns = ["createdAt", "type", "status", "updatedAt"];
    const validSortOrders = ["asc", "desc"];

    let order = [["createdAt", "desc"]]; // Default sorting

    if (sortBy && validSortColumns.includes(sortBy.toLowerCase())) {
      const direction = validSortOrders.includes(sortOrder?.toLowerCase())
        ? sortOrder
        : "desc";
      order = [[sortBy, direction]];
    }

    // 🧩 YOLO include with optional cameraId filter and full camera details
    const yoloInclude = {
      model: YOLOIncident,
      as: "yoloDetails",
      attributes: [
        "id",
        "cameraId",
        "aiType",
        "confidence",
        "detectionFrameUrl",
        "modelVersion",
        "detectedObjects",
        "processingTime",
      ],
      required: false,
      where: {},
      include: [
        {
          model: Camera,
          as: "camera",
          attributes: [
            "id",
            "name",
            "ipAddress",
            "rtspUrl",
            "location",
            "longitude",
            "latitude",
            "model",
            "description",
            "status",
            "lastCheckedAt",
            "lastOnlineAt",
          ],
          required: false,
        },
      ],
    };

    // Apply cameraId filter to YOLOIncident if provided
    if (cameraId) yoloInclude.where.cameraId = cameraId;

    const { count, rows } = await Incident.findAndCountAll({
      where: whereCondition,
      include: [
        {
          model: HumanIncident,
          as: "humanDetails",
          attributes: ["id", "reportedBy", "contact", "ipAddress"],
          required: false,
        },
        yoloInclude,
        {
          model: User,
          as: "accepters",
          attributes: ["id", "firstname", "lastname", "email", "contact"],
          through: { attributes: ["acceptedAt"] },
        },
        {
          model: User,
          as: "dismissers",
          attributes: ["id", "firstname", "lastname", "email", "contact"],
          through: { attributes: ["dismissedAt"] },
        },
      ],
      paranoid: false, // Include soft-deleted records
      offset,
      limit: limitNumber,
      order,
      distinct: true,
    });

    return res.status(StatusCodes.OK).json({
      success: true,
      message: "Deleted incidents retrieved successfully",
      totalIncidents: count,
      totalPages: Math.ceil(count / limitNumber),
      currentPage: pageNumber,
      data: rows,
    });
  } catch (error) {
    console.error("An error occurred: " + error);
    next(error);
  }
};

// ============================================
// UPDATED: resolveIncident function
// ============================================
const resolveIncident = async (req, res, next) => {
  let transaction;

  try {
    transaction = await sequelize.transaction();

    const { id } = req.params;
    const { resolutionNotes } = req.body;

    if (!id) throw new BadRequestError("Incident ID is required");

    const incident = await Incident.findByPk(id);
    if (!incident) throw new NotFoundError("Incident not found");

    // Update incident status to resolved
    await incident.update(
      {
        status: "resolved",
        description: resolutionNotes
          ? `${
              incident.description || ""
            }\n\nResolution Notes: ${resolutionNotes}`
          : incident.description,
      },
      { transaction }
    );

    await transaction.commit();
    transaction = null;

    // Fetch updated incident with associations
    const resolvedIncident = await Incident.findByPk(id, {
      include: [
        {
          model: HumanIncident,
          as: "humanDetails",
          attributes: ["id", "reportedBy", "contact", "ipAddress"],
          required: false,
        },
        {
          model: YOLOIncident,
          as: "yoloDetails",
          attributes: [
            "id",
            "cameraId",
            "aiType",
            "confidence",
            "detectionFrameUrl",
            "modelVersion",
            "detectedObjects",
            "processingTime",
          ],
          required: false,
          include: [
            {
              model: Camera,
              as: "camera",
              attributes: [
                "id",
                "name",
                "ipAddress",
                "rtspUrl",
                "location",
                "longitude",
                "latitude",
                "model",
                "description",
                "status",
                "lastCheckedAt",
                "lastOnlineAt",
              ],
              required: false,
            },
          ],
        },
        {
          model: User,
          as: "accepters",
          attributes: ["id", "firstname", "lastname", "email", "contact"],
          through: { attributes: ["acceptedAt"] },
        },
        {
          model: User,
          as: "dismissers",
          attributes: ["id", "firstname", "lastname", "email", "contact"],
          through: { attributes: ["dismissedAt"] },
        },
      ],
    });

    return res.status(StatusCodes.OK).json({
      success: true,
      message: "Incident resolved successfully",
      data: resolvedIncident,
    });
  } catch (error) {
    if (transaction) await transaction.rollback();
    console.error("An error occurred: " + error);
    next(error);
  }
};

// ============================================
// UPDATED: globalDismissIncident function
// ============================================
const globalDismissIncident = async (req, res, next) => {
  let transaction;

  try {
    transaction = await sequelize.transaction();

    const { id } = req.params;
    const { userId, reason } = req.body;

    if (!id) throw new BadRequestError("Incident ID is required");
    if (!reason) throw new BadRequestError("Reason for dismissal is required");

    // Validate incident exists
    const incident = await Incident.findByPk(id);
    if (!incident) throw new NotFoundError("Incident not found");

    // If userId is provided, validate user exists and record the dismissal
    if (userId) {
      const user = await User.findByPk(userId);
      if (!user) throw new NotFoundError("User not found");

      await IncidentDismissal.create(
        {
          incidentId: id,
          userId,
          dismissedAt: new Date(),
          reason,
        },
        { transaction }
      );
    }

    // Update incident status to dismissed
    await incident.update(
      {
        status: "dismissed",
        description: reason
          ? `${incident.description || ""}\n\nDismissal Reason: ${reason}`
          : incident.description,
      },
      { transaction }
    );

    await transaction.commit();
    transaction = null;

    // Fetch updated incident with associations
    const dismissedIncident = await Incident.findByPk(id, {
      include: [
        {
          model: HumanIncident,
          as: "humanDetails",
          attributes: ["id", "reportedBy", "contact", "ipAddress"],
          required: false,
        },
        {
          model: YOLOIncident,
          as: "yoloDetails",
          attributes: [
            "id",
            "cameraId",
            "aiType",
            "confidence",
            "detectionFrameUrl",
            "modelVersion",
            "detectedObjects",
            "processingTime",
          ],
          required: false,
          include: [
            {
              model: Camera,
              as: "camera",
              attributes: [
                "id",
                "name",
                "ipAddress",
                "rtspUrl",
                "location",
                "longitude",
                "latitude",
                "model",
                "description",
                "status",
                "lastCheckedAt",
                "lastOnlineAt",
              ],
              required: false,
            },
          ],
        },
        {
          model: User,
          as: "accepters",
          attributes: ["id", "firstname", "lastname", "email", "contact"],
          through: { attributes: ["acceptedAt"] },
        },
        {
          model: User,
          as: "dismissers",
          attributes: ["id", "firstname", "lastname", "email", "contact"],
          through: { attributes: ["dismissedAt", "reason"] },
        },
      ],
    });

    return res.status(StatusCodes.OK).json({
      success: true,
      message: "Incident globally dismissed successfully",
      data: dismissedIncident,
    });
  } catch (error) {
    if (transaction) await transaction.rollback();
    console.error("An error occurred: " + error);
    next(error);
  }
};

// ============================================
// UPDATED: getDismissedIncidentsByUser function
// ============================================
const getDismissedIncidentsByUser = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const { page, limit } = req.query;

    if (!userId) throw new BadRequestError("User ID is required");

    // Validate user exists
    const user = await User.findByPk(userId);
    if (!user) throw new NotFoundError("User not found");

    // Pagination
    const pageNumber = Number.parseInt(page) || 1;
    const limitNumber = Number.parseInt(limit) || 10;
    const offset = (pageNumber - 1) * limitNumber;

    // Get incidents dismissed by this user
    const incidents = await User.findByPk(userId, {
      include: [
        {
          model: Incident,
          as: "dismissedIncidents",
          include: [
            {
              model: HumanIncident,
              as: "humanDetails",
              attributes: ["id", "reportedBy", "contact", "ipAddress"],
              required: false,
            },
            {
              model: YOLOIncident,
              as: "yoloDetails",
              attributes: [
                "id",
                "cameraId",
                "aiType",
                "confidence",
                "detectionFrameUrl",
                "modelVersion",
                "detectedObjects",
                "processingTime",
              ],
              required: false,
              include: [
                {
                  model: Camera,
                  as: "camera",
                  attributes: [
                    "id",
                    "name",
                    "ipAddress",
                    "rtspUrl",
                    "location",
                    "longitude",
                    "latitude",
                    "model",
                    "description",
                    "status",
                    "lastCheckedAt",
                    "lastOnlineAt",
                  ],
                  required: false,
                },
              ],
            },
          ],
          through: { attributes: ["dismissedAt", "reason"] },
        },
      ],
      limit: limitNumber,
      offset,
    });

    if (!incidents || !incidents.dismissedIncidents) {
      return res.status(StatusCodes.OK).json({
        success: true,
        message: "No dismissed incidents found for this user",
        data: [],
        count: 0,
      });
    }

    return res.status(StatusCodes.OK).json({
      success: true,
      message: "User dismissed incidents retrieved successfully",
      data: incidents.dismissedIncidents,
      count: incidents.dismissedIncidents.length,
    });
  } catch (error) {
    console.error("An error occurred: " + error);
    next(error);
  }
};

// ============================================
// UPDATED: getIncidentsByUser function
// ============================================
const getIncidentsByUser = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const { page, limit } = req.query;

    if (!userId) throw new BadRequestError("User ID is required");

    // Validate user exists
    const user = await User.findByPk(userId);
    if (!user) throw new NotFoundError("User not found");

    // Pagination
    const pageNumber = Number.parseInt(page) || 1;
    const limitNumber = Number.parseInt(limit) || 10;
    const offset = (pageNumber - 1) * limitNumber;

    // Get incidents accepted by this user
    const incidents = await User.findByPk(userId, {
      include: [
        {
          model: Incident,
          as: "acceptedIncidents",
          include: [
            {
              model: HumanIncident,
              as: "humanDetails",
              attributes: ["id", "reportedBy", "contact", "ipAddress"],
              required: false,
            },
            {
              model: YOLOIncident,
              as: "yoloDetails",
              attributes: [
                "id",
                "cameraId",
                "aiType",
                "confidence",
                "detectionFrameUrl",
                "modelVersion",
                "detectedObjects",
                "processingTime",
              ],
              required: false,
              include: [
                {
                  model: Camera,
                  as: "camera",
                  attributes: [
                    "id",
                    "name",
                    "ipAddress",
                    "rtspUrl",
                    "location",
                    "longitude",
                    "latitude",
                    "model",
                    "description",
                    "status",
                    "lastCheckedAt",
                    "lastOnlineAt",
                  ],
                  required: false,
                },
              ],
            },
          ],
          through: { attributes: ["acceptedAt"] },
        },
      ],
      limit: limitNumber,
      offset,
    });

    if (!incidents || !incidents.acceptedIncidents) {
      return res.status(StatusCodes.OK).json({
        success: true,
        message: "No accepted incidents found for this user",
        data: [],
        count: 0,
      });
    }

    return res.status(StatusCodes.OK).json({
      success: true,
      message: "User accepted incidents retrieved successfully",
      data: incidents.acceptedIncidents,
      count: incidents.acceptedIncidents.length,
    });
  } catch (error) {
    console.error("An error occurred: " + error);
    next(error);
  }
};

// ============================================
// UPDATED: getIncidentStats function
// ============================================
const getIncidentStats = async (req, res, next) => {
  try {
    // Count incidents by status
    const statusCounts = await Incident.findAll({
      attributes: [
        "status",
        [sequelize.fn("COUNT", sequelize.col("status")), "count"],
      ],
      group: ["status"],
    });

    // Count incidents by type
    const typeCounts = await Incident.findAll({
      attributes: [
        "type",
        [sequelize.fn("COUNT", sequelize.col("type")), "count"],
      ],
      group: ["type"],
    });

    // Count incidents by report type (human vs yolo)
    const reportTypeCounts = await Incident.findAll({
      attributes: [
        "reportType",
        [sequelize.fn("COUNT", sequelize.col("reportType")), "count"],
      ],
      group: ["reportType"],
    });

    // Get recent incidents with details
    const recentIncidents = await Incident.findAll({
      limit: 5,
      order: [["createdAt", "DESC"]],
      include: [
        {
          model: HumanIncident,
          as: "humanDetails",
          attributes: ["id", "reportedBy", "contact", "ipAddress"],
          required: false,
        },
        {
          model: YOLOIncident,
          as: "yoloDetails",
          attributes: [
            "id",
            "cameraId",
            "aiType",
            "confidence",
            "detectionFrameUrl",
            "modelVersion",
            "detectedObjects",
            "processingTime",
          ],
          required: false,
          include: [
            {
              model: Camera,
              as: "camera",
              attributes: [
                "id",
                "name",
                "ipAddress",
                "rtspUrl",
                "location",
                "longitude",
                "latitude",
                "model",
                "description",
                "status",
                "lastCheckedAt",
                "lastOnlineAt",
              ],
              required: false,
            },
          ],
        },
      ],
    });

    // Get count of incidents created in the last 24 hours
    const last24Hours = await Incident.count({
      where: {
        createdAt: {
          [Op.gte]: new Date(new Date() - 24 * 60 * 60 * 1000),
        },
      },
    });

    // Get count of incidents created in the last 7 days
    const last7Days = await Incident.count({
      where: {
        createdAt: {
          [Op.gte]: new Date(new Date() - 7 * 24 * 60 * 60 * 1000),
        },
      },
    });

    // Count incidents by source using raw SQL
    const sourceStats = await sequelize.query(
      `
      SELECT 
        CASE WHEN i.\`reportType\` = 'human' THEN 'user-reported' ELSE 'camera-detected' END as source,
        COUNT(*) as count
      FROM \`Incidents\` i
      WHERE i.\`deletedAt\` IS NULL
      GROUP BY i.\`reportType\`
    `,
      { type: sequelize.QueryTypes.SELECT }
    );

    return res.status(StatusCodes.OK).json({
      success: true,
      message: "Incident statistics retrieved successfully",
      data: {
        byStatus: statusCounts,
        byType: typeCounts,
        byReportType: reportTypeCounts,
        bySource: sourceStats,
        recentIncidents,
        last24Hours,
        last7Days,
        total: await Incident.count(),
      },
    });
  } catch (error) {
    console.error("An error occurred: " + error);
    next(error);
  }
};

export {
  createIncident,
  createCitizenReport,
  createCameraDetection,
  getIncidents,
  getIncident,
  updateIncident,
  softDeleteIncident,
  restoreIncident,
  getDeletedIncidents,
  acceptIncident,
  resolveIncident,
  dismissIncident,
  globalDismissIncident,
  getIncidentsByUser,
  getUsersByIncident,
  getDismissedIncidentsByUser,
  getIncidentStats,
  generateEmptyTemplate,
  getIncidentsForHeatmap,
};
