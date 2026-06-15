// models/Deployment.js
import { DataTypes } from "sequelize";
import sequelize from "../../config/database.js";

const Deployment = sequelize.define(
  "Deployment",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    inventory_item_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: "inventory_items",
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "RESTRICT",
    },
    deployed_by: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: "users",
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "RESTRICT",
    },
    deployed_to: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: "users",
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "RESTRICT",
    },
    deployment_type: {
      type: DataTypes.ENUM(
        "EMERGENCY",
        "TRAINING",
        "MAINTENANCE",
        "RELIEF_OPERATION"
      ),
      allowNull: false,
    },
    quantity_deployed: {
      type: DataTypes.INTEGER,
      allowNull: false,
      validate: {
        min: {
          args: [1],
          msg: "Quantity deployed must be at least 1",
        },
        isInt: {
          msg: "Quantity deployed must be an integer",
        },
      },
    },
    deployment_location: {
      type: DataTypes.STRING(255),
      allowNull: false,
      validate: {
        notEmpty: {
          msg: "Deployment location cannot be empty",
        },
        len: {
          args: [1, 255],
          msg: "Deployment location must be between 1 and 255 characters",
        },
      },
    },
    deployment_date: {
      type: DataTypes.DATE,
      allowNull: false,
      validate: {
        isDate: {
          msg: "Must be a valid date",
        },
      },
    },
    expected_return_date: {
      type: DataTypes.DATE,
      allowNull: true,
      validate: {
        isDate: {
          msg: "Must be a valid date",
        },
      },
    },
    actual_return_date: {
      type: DataTypes.DATE,
      allowNull: true,
      validate: {
        isDate: {
          msg: "Must be a valid date",
        },
      },
    },
    status: {
      type: DataTypes.ENUM(
        "DEPLOYED",
        "RETURNED",
        "LOST",
        "DAMAGED",
        "PARTIAL_RETURN"
      ),
      defaultValue: "DEPLOYED",
      allowNull: false,
    },
    incident_type: {
      type: DataTypes.STRING(100), // Reduced from 255 for better performance
      allowNull: true,
      validate: {
        len: {
          args: [0, 100],
          msg: "Incident type must be less than 100 characters",
        },
      },
    },
  },
  {
    timestamps: true,
    paranoid: true,
    tableName: "deployments",
    // Optimized indexes
    indexes: [
      {
        name: "idx_deployments_inventory_item",
        fields: ["inventory_item_id"],
      },
      {
        name: "idx_deployments_deployed_by",
        fields: ["deployed_by"],
      },
      {
        name: "idx_deployments_deployed_to",
        fields: ["deployed_to"],
      },
      {
        name: "idx_deployments_type_status",
        fields: ["deployment_type", "status"], // Composite index for common queries
      },
      {
        name: "idx_deployments_date_status",
        fields: ["deployment_date", "status"], // Composite for date-based filtering
      },
      {
        name: "idx_deployments_location",
        fields: ["deployment_location"],
      },
      {
        name: "idx_deployments_deleted_at",
        fields: ["deletedAt"],
        where: {
          deletedAt: {
            [sequelize.Sequelize.Op.ne]: null,
          },
        },
      },
    ],
    hooks: {
      beforeValidate: (deployment) => {
        // Normalize location string
        if (deployment.deployment_location) {
          deployment.deployment_location =
            deployment.deployment_location.trim();
        }
      },
      beforeUpdate: (deployment) => {
        // Auto-set actual_return_date when status changes to RETURNED
        if (
          deployment.status === "RETURNED" &&
          !deployment.actual_return_date
        ) {
          deployment.actual_return_date = new Date();
        }
      },
    },
  }
);

export default Deployment;
