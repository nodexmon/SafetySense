// models/DeploymentNotes.js
import { DataTypes } from "sequelize";
import sequelize from "../../config/database.js";

const DeploymentNotes = sequelize.define(
  "DeploymentNotes",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    deployment_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: "deployments",
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "CASCADE", // When deployment is deleted, remove all its notes
    },
    note_text: {
      type: DataTypes.TEXT,
      allowNull: false,
      validate: {
        notEmpty: {
          msg: "Note text cannot be empty",
        },
        len: {
          args: [1, 5000], // Reasonable limit for notes
          msg: "Note text must be between 1 and 5000 characters",
        },
      },
    },
    note_type: {
      type: DataTypes.ENUM("USER", "SYSTEM"),
      defaultValue: "USER",
      allowNull: false,
    },
    created_by: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: "users",
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "RESTRICT", // Don't delete user if they have notes
    },
  },
  {
    timestamps: true,
    paranoid: true, // Soft delete for audit trail
    tableName: "deployment_notes",
    // Optimized indexes
    indexes: [
      {
        name: "idx_deployment_notes_deployment_id",
        fields: ["deployment_id"],
      },
      {
        name: "idx_deployment_notes_created_by",
        fields: ["created_by"],
      },
      {
        name: "idx_deployment_notes_type_created",
        fields: ["note_type", "createdAt"], // For filtering by type and sorting
      },
      {
        name: "idx_deployment_notes_deployment_created",
        fields: ["deployment_id", "createdAt"], // For getting deployment notes chronologically
      },
      {
        name: "idx_deployment_notes_deleted_at",
        fields: ["deletedAt"],
        where: {
          deletedAt: {
            [sequelize.Sequelize.Op.ne]: null,
          },
        },
      },
    ],
    hooks: {
      beforeValidate: (note) => {
        // Normalize note text
        if (note.note_text) {
          note.note_text = note.note_text.trim();
        }
      },
      afterCreate: async (note) => {
        // Optional: Update deployment's updatedAt timestamp when a note is added
        try {
          await sequelize.models.Deployment.update(
            { updatedAt: new Date() },
            {
              where: { id: note.deployment_id },
              silent: false, // This will trigger hooks and validations
            }
          );
        } catch (error) {
          console.warn("Failed to update deployment timestamp:", error);
        }
      },
    },
  }
);

export default DeploymentNotes;
