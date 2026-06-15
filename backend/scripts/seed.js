import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import models from "../models/index.js";

dotenv.config();

const {
  sequelize,
  User,
  LoginHistory,
  Category,
  InventoryItem,
  Batch,
  Deployment,
  InventoryNotification,
  Notification,
  Camera,
  CameraHealthCheck,
  CameraLog,
  Incident,
  HumanIncident,
  YOLOIncident,
} = models;

const daysFromNow = (days) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date;
};

const findOrCreateBy = async (model, where, defaults = {}) => {
  const [record] = await model.findOrCreate({ where, defaults });
  return record;
};

async function seedUsers() {
  const password = await bcrypt.hash("Password123!", 10);

  const admin = await findOrCreateBy(
    User,
    { email: "admin@safetysense.local" },
    {
      firstname: "Avery",
      lastname: "Admin",
      password,
      role: "admin",
      isVerified: true,
      contact: "+639171110001",
    }
  );

  const rescuer = await findOrCreateBy(
    User,
    { email: "rescuer@safetysense.local" },
    {
      firstname: "Riley",
      lastname: "Responder",
      password,
      role: "rescuer",
      isVerified: true,
      contact: "+639171110002",
    }
  );

  const dispatcher = await findOrCreateBy(
    User,
    { email: "dispatcher@safetysense.local" },
    {
      firstname: "Casey",
      lastname: "Dispatcher",
      password,
      role: "rescuer",
      isVerified: true,
      contact: "+639171110003",
    }
  );

  if ((await LoginHistory.count()) === 0) {
    await LoginHistory.bulkCreate([
      {
        userId: admin.id,
        login: daysFromNow(-2),
        logout: daysFromNow(-2),
      },
      {
        userId: rescuer.id,
        login: daysFromNow(-1),
      },
    ]);
  }

  return { admin, rescuer, dispatcher };
}

async function seedInventory(users) {
  const categories = {};

  for (const category of [
    {
      name: "Rescue Equipment",
      type: "EQUIPMENT",
      description: "Reusable equipment for field response.",
    },
    {
      name: "Medical Supplies",
      type: "SUPPLIES",
      description: "Consumable medical and first-aid supplies.",
    },
    {
      name: "Communication Devices",
      type: "COMMUNICATION_DEVICES",
      description: "Radios and communication tools.",
    },
  ]) {
    categories[category.name] = await findOrCreateBy(
      Category,
      { name: category.name },
      category
    );
  }

  const items = {};

  for (const item of [
    {
      name: "Rescue Rope Kit",
      description: "Static rope, harnesses, carabiners, and anchor gear.",
      category_id: categories["Rescue Equipment"].id,
      quantity_in_stock: 12,
      min_stock_level: 4,
      unit_of_measure: "kit",
      location: "Main Storage Room",
      is_deployable: true,
      is_returnable: true,
      notes: "Inspect after each deployment.",
    },
    {
      name: "First Aid Pack",
      description: "Compact field pack with bandages and trauma supplies.",
      category_id: categories["Medical Supplies"].id,
      quantity_in_stock: 40,
      min_stock_level: 15,
      unit_of_measure: "pack",
      location: "Clinic Cabinet A",
      is_deployable: true,
      is_returnable: false,
      notes: "Consumable.",
    },
    {
      name: "Handheld Radio",
      description: "VHF handheld radio with spare battery.",
      category_id: categories["Communication Devices"].id,
      quantity_in_stock: 8,
      min_stock_level: 3,
      unit_of_measure: "unit",
      location: "Dispatch Desk",
      is_deployable: true,
      is_returnable: true,
      next_maintenance_date: daysFromNow(30),
    },
  ]) {
    items[item.name] = await findOrCreateBy(InventoryItem, { name: item.name }, item);
  }

  await Batch.bulkCreate(
    [
      {
        inventory_item_id: items["Rescue Rope Kit"].id,
        batch_number: "SEED-ROPE-001",
        quantity: 12,
        supplier: "Local Rescue Supply",
        received_date: daysFromNow(-45),
        received_by: users.admin.id,
        funding_source: "Municipal DRRM",
        unit_price: 3200,
        amount: 38400,
      },
      {
        inventory_item_id: items["First Aid Pack"].id,
        batch_number: "SEED-AID-001",
        quantity: 40,
        supplier: "Health Office",
        received_date: daysFromNow(-20),
        received_by: users.admin.id,
        funding_source: "Health Preparedness Fund",
        unit_price: 450,
        amount: 18000,
      },
      {
        inventory_item_id: items["Handheld Radio"].id,
        batch_number: "SEED-RADIO-001",
        quantity: 8,
        supplier: "Comms Depot",
        received_date: daysFromNow(-60),
        received_by: users.admin.id,
        funding_source: "Operations Budget",
        unit_price: 2500,
        amount: 20000,
      },
    ],
    { ignoreDuplicates: true }
  );

  if ((await Deployment.count()) === 0) {
    await Deployment.bulkCreate([
      {
        inventory_item_id: items["First Aid Pack"].id,
        deployed_by: users.admin.id,
        deployed_to: users.rescuer.id,
        deployment_type: "EMERGENCY",
        quantity_deployed: 5,
        deployment_location: "Barangay Zone 1",
        deployment_date: daysFromNow(-3),
        expected_return_date: null,
        status: "DEPLOYED",
        incident_type: "Medical",
      },
      {
        inventory_item_id: items["Handheld Radio"].id,
        deployed_by: users.admin.id,
        deployed_to: users.dispatcher.id,
        deployment_type: "TRAINING",
        quantity_deployed: 2,
        deployment_location: "Municipal Gymnasium",
        deployment_date: daysFromNow(-10),
        expected_return_date: daysFromNow(-8),
        actual_return_date: daysFromNow(-8),
        status: "RETURNED",
        incident_type: "Training",
      },
    ]);
  }

  if ((await InventoryNotification.count()) === 0) {
    await InventoryNotification.bulkCreate([
      {
        notification_type: "LOW_STOCK",
        inventory_item_id: items["Handheld Radio"].id,
        user_id: users.admin.id,
        title: "Radio stock needs review",
        message: "Handheld Radio is close to its minimum stock level.",
        priority: "HIGH",
      },
      {
        notification_type: "MAINTENANCE_DUE",
        inventory_item_id: items["Handheld Radio"].id,
        user_id: users.admin.id,
        title: "Maintenance scheduled",
        message: "Handheld radios have maintenance due within 30 days.",
        priority: "MEDIUM",
      },
    ]);
  }

  return { categories, items };
}

async function seedCameras(users) {
  const camera = await findOrCreateBy(
    Camera,
    { rtspUrl: "rtsp://192.168.10.10:554/live" },
    {
      name: "Municipal Hall Entrance",
      ipAddress: "192.168.10.10",
      location: "Municipal Hall",
      longitude: "121.4089",
      latitude: "13.0571",
      model: "DemoCam X100",
      description: "Seed camera for dashboard and AI incident testing.",
      status: "online",
      lastCheckedAt: new Date(),
      lastOnlineAt: new Date(),
    }
  );

  if ((await CameraHealthCheck.count()) === 0) {
    await CameraHealthCheck.bulkCreate([
      {
        cameraId: camera.id,
        status: "online",
        checkedAt: daysFromNow(-1),
      },
    ]);
  }

  if ((await CameraLog.count()) === 0) {
    await CameraLog.bulkCreate([
      {
        cameraId: camera.id,
        userId: users.admin.id,
        actionType: "STATUS_CHANGE",
        oldStatus: "unknown",
        newStatus: "online",
        description: "Seeded camera marked online.",
      },
    ]);
  }

  return { camera };
}

async function seedIncidents(camera) {
  const humanIncident = await Incident.create({
    reportType: "human",
    type: "Medical",
    description: "Resident reported dizziness and requested medical assistance.",
    status: "accepted",
    longitude: "121.4092",
    latitude: "13.0568",
    snapshotUrl: "incidents/sample-medical.txt",
  });

  await HumanIncident.create({
    incidentId: humanIncident.id,
    reportedBy: "Juan Dela Cruz",
    contact: "+639171119999",
    ipAddress: "127.0.0.1",
  });

  const yoloIncident = await Incident.create({
    reportType: "yolo",
    type: "Fire",
    description: "AI camera detection flagged possible smoke or fire.",
    status: "pending",
    longitude: "121.4089",
    latitude: "13.0571",
    snapshotUrl: "incidents/sample-fire.txt",
  });

  await YOLOIncident.create({
    incidentId: yoloIncident.id,
    cameraId: camera.id,
    aiType: "fire",
    confidence: 0.91,
    modelVersion: "seed-demo-v1",
    detectionFrameUrl: "incidents/sample-fire-frame.txt",
    detectedObjects: [{ label: "fire", confidence: 0.91 }],
    processingTime: 148.5,
  });

  return { humanIncident, yoloIncident };
}

async function seedNotifications(users) {
  if ((await Notification.count()) > 0) return;

  await Notification.bulkCreate([
      {
        userId: users.admin.id,
        actionType: "SYSTEM_GENERATED",
        entityType: "Inventory",
        description: "Demo seed data has been loaded.",
        priority: "MEDIUM",
        title: "Seed data ready",
      },
      {
        userId: users.rescuer.id,
        actionType: "CAMERA_ONLINE",
        entityType: "Camera",
        description: "Municipal Hall Entrance camera is online.",
        priority: "LOW",
        title: "Camera online",
      },
  ]);
}

async function run() {
  try {
    await sequelize.authenticate();
    await sequelize.sync();

    const existingUsers = await User.count();
    if (existingUsers > 0 && process.argv.includes("--skip-if-any-data")) {
      console.log("Seed skipped because data already exists.");
      return;
    }

    const users = await seedUsers();
    await seedInventory(users);
    const { camera } = await seedCameras(users);

    const incidentCount = await Incident.count();
    if (incidentCount === 0) {
      await seedIncidents(camera);
    }

    await seedNotifications(users);

    console.log("Seed complete.");
    console.log("Demo accounts:");
    console.log("  admin@safetysense.local / Password123!");
    console.log("  rescuer@safetysense.local / Password123!");
  } catch (error) {
    console.error("Seed failed:", error);
    process.exitCode = 1;
  } finally {
    await sequelize.close();
  }
}

run();
